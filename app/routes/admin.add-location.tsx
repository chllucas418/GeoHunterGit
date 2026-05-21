import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData, Link, useFetcher } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";
import { requireTeacher } from "~/lib/auth.server";
import { analyzeImageQuality, batchAnalyzeOfficialEvidence } from "~/lib/gemini.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireTeacher(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    let existingLocation = null;
    if (id) {
        existingLocation = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first<any>();
    }

    const { results: mapSets } = await db.prepare("SELECT id, name FROM map_sets ORDER BY created_at DESC").all<any>();

    return {
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        existingLocation,
        mapSets
    };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireTeacher(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    let imageUrl = (formData.get("imageUrl") || formData.get("base64Image")) as string;

    if (intent === "analyze") {
        const env = context.cloudflare.env as any;
        const lat = parseFloat(formData.get("lat") as string);
        const lng = parseFloat(formData.get("lng") as string);
        const evidenceListJson = formData.get("evidenceList") as string;

        try {
            const contextData = {
                lat: isNaN(lat) ? undefined : lat,
                lng: isNaN(lng) ? undefined : lng,
                evidenceList: evidenceListJson ? JSON.parse(evidenceListJson) : []
            };
            const analysis = await analyzeImageQuality(
                imageUrl,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY,
                contextData
            );
            return { analysis };
        } catch (e) {
            console.error("AI Analysis error:", e);
            return { error: "AI analysis failed" };
        }
    }

    const lat = parseFloat(formData.get("lat") as string);
    const lng = parseFloat(formData.get("lng") as string);
    const difficulty = parseFloat(formData.get("difficulty") as string);
    const qualityScore = parseInt(formData.get("qualityScore") as string) || 100;
    const evidenceListJson = formData.get("evidenceList") as string;
    const hints = formData.get("hints") as string;
    const photographer = formData.get("photographer") as string;

    if (!imageUrl || isNaN(lat) || isNaN(lng)) {
        return { error: "Image and coordinates are required" };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const bucket = env.ASSETS_BUCKET as R2Bucket;
    const existingId = formData.get("existingId") as string;

    const metadata = photographer ? JSON.stringify({ photographer }) : null;

    try {
        let locationId = existingId;
        if (!locationId) {
            locationId = `loc_${Math.random().toString(36).substring(2, 9)}`;
        }

        // Handle Image Upload to R2 if it's a base64 string
        let finalImageUrl = imageUrl;
        if (imageUrl.startsWith("data:")) {
            // Extract base64 data
            const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const contentType = matches[1];
                const buffer = Uint8Array.from(atob(matches[2]), c => c.charCodeAt(0));

                const key = `locations/${locationId}.jpg`; // Normalize to jpg or determine extension from contentType

                await bucket.put(key, buffer, {
                    httpMetadata: { contentType: contentType }
                });

                finalImageUrl = `https://assets.hkgeohunter.com/${key}`;
            }
        }

        const description = formData.get("description") as string;
        if (existingId) {
            await db.prepare(
                "UPDATE locations SET image_url = ?, lat = ?, lng = ?, difficulty_rating = ?, quality_score = ?, hints = ?, image_metadata = ?, description = ? WHERE id = ?"
            ).bind(finalImageUrl, lat, lng, difficulty, qualityScore, hints, metadata, description, existingId).run();
        } else {
            await db.prepare(
                "INSERT INTO locations (id, image_url, lat, lng, difficulty_rating, quality_score, verified_by_gemini, hints, image_metadata, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(locationId, finalImageUrl, lat, lng, difficulty, qualityScore, 1, hints, metadata, description).run();
        }

        // Handle Evidence
        if (evidenceListJson) {
            const evidenceList = JSON.parse(evidenceListJson);

            // Safe-guard: delete old evidence for this location
            await db.prepare("DELETE FROM map_evidence WHERE location_id = ? AND created_by_user_id IS NULL").bind(locationId).run();

            // Generate actual AI analyses for each official evidence item
            let analyses: any[] = [];
            if (evidenceList.length > 0) {
                try {
                    console.log("[AddLocation API] Generating AI analyses for evidence...", finalImageUrl);
                    analyses = await batchAnalyzeOfficialEvidence(
                        finalImageUrl,
                        evidenceList.map((ev: any, idx: number) => ({
                            id: String(idx),
                            box: ev.box,
                            description: ev.description
                        })),
                        env.GEMINI_BASE_URL,
                        env.GEMINI_GATEWAY_TOKEN,
                        env.GEMINI_API_KEY
                    );
                } catch (e) {
                    console.error("[AddLocation API] Failed to generate AI analysis:", e);
                }
            }

            const stmt = db.prepare("INSERT INTO map_evidence (id, location_id, bounding_box, description, is_verified, ai_analysis) VALUES (?, ?, ?, ?, 1, ?)");

            const batch = evidenceList.map((ev: any, idx: number) => {
                const matchedAnalysis = analyses.find((a: any) => a.id === String(idx));
                const aiText = matchedAnalysis?.ai_analysis || `Factual target landmark: ${ev.description}. Key geographic identifier in this sector.`;
                return stmt.bind(
                    `ev_${Math.random().toString(36).substring(2, 9)}`,
                    locationId,
                    JSON.stringify(ev.box),
                    ev.description,
                    aiText
                );
            });
            if (batch.length > 0) await db.batch(batch);
        }



        // Handle Dataset Assignment
        const setId = formData.get("addToSet") as string;
        if (setId) {
            // Check if already in set
            const exists = await db.prepare("SELECT 1 FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(setId, locationId).first();
            if (!exists) {
                // Get next order
                const max = await db.prepare("SELECT MAX(order_index) as m FROM map_set_items WHERE set_id = ?").bind(setId).first<any>();
                const nextOrder = (max?.m || 0) + 1;
                await db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)").bind(setId, locationId, nextOrder).run();
            }
        }

        return { success: true, message: `Location saved and added to dataset!` };
    } catch (e) {
        console.error("Save location error:", e);
        return { error: "Failed to save location" };
    }
}

export default function AddLocation() {
    const { mapsApiKey, existingLocation, mapSets } = useLoaderData() as any;
    const actionData = useActionData() as any;
    const fetcher = useFetcher() as any;
    const navigation = useNavigation();

    const isSubmitting = navigation.state === "submitting" && navigation.formData?.get("intent") === "deploy";
    const isAnalyzing = fetcher.state === "submitting" || (fetcher.state === "loading" && fetcher.formData?.get("intent") === "analyze");
    const analysis = fetcher.data?.analysis;

    const mapRef = useRef<HTMLDivElement>(null);
    const markerRef = useRef<any>(null);
    const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(
        existingLocation ? { lat: existingLocation.lat, lng: existingLocation.lng } : null
    );
    // Parse metadata safely (it might be JSON string or null)
    const initialMetadata = existingLocation?.image_metadata ? JSON.parse(existingLocation.image_metadata) : {};

    const [previewUrl, setPreviewUrl] = useState<string>(existingLocation?.image_url ?? "");
    const [base64, setBase64] = useState<string>(existingLocation?.image_url ?? "");
    const [qualityScore, setQualityScore] = useState<number>(existingLocation?.quality_score ?? 80);
    const [difficulty, setDifficulty] = useState<number>(existingLocation?.difficulty_rating ?? 5);
    const [hintsList, setHintsList] = useState<string[]>(
        existingLocation?.hints ?
            (() => {
                try { return JSON.parse(existingLocation.hints); } catch { return existingLocation.hints ? existingLocation.hints.split(/\n\n|\n/) : []; }
            })()
            : []
    );
    const [locationDescription, setLocationDescription] = useState<string>(existingLocation?.description ?? "");
    const [photographer, setPhotographer] = useState<string>(initialMetadata.photographer ?? "");
    const [hintPins, setHintPins] = useState<{lat: number, lng: number, description: string}[]>([]);

    const [evidenceStep, setEvidenceStep] = useState(false);
    const [evidenceList, setEvidenceList] = useState<{ box: BoxCoordinates; description: string; id: string }[]>([]);
    const [currentBox, setCurrentBox] = useState<BoxCoordinates | null>(null);
    const [showDescModal, setShowDescModal] = useState(false);
    const [tempDesc, setTempDesc] = useState("");
    const [isEvidenceFullscreen, setIsEvidenceFullscreen] = useState(false);

    // --- AI Chat Agent State ---
    const [chatHistory, setChatHistory] = useState<{role: string, text: string, isAction?: boolean, actionType?: string, actionData?: string}[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [isChatting, setIsChatting] = useState(false);
    const [chatModel, setChatModel] = useState("gemini-3.5-flash");
    const chatScrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll chat
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatHistory, isChatting]);

    const handleChatSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!chatInput.trim() || isChatting) return;

        const userMsg = chatInput.trim();
        setChatInput("");
        setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
        setIsChatting(true);

        try {
            const formattedHistory = chatHistory.map(msg => ({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.text }]
            }));

            const res = await fetch("/api/admin/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    modelName: chatModel,
                    message: userMsg,
                    history: formattedHistory,
                    base64Image: base64,
                    location: marker,
                    evidenceList: evidenceList
                })
            });

            const data = await res.json() as any;
            if (data.error) throw new Error(data.error);

            // Quick hack to parse JSON blocks for action suggestions
            const jsonMatch = data.text.match(/```json\s([\s\S]*?)\s```/);
            let actionData = null;
            let actionType: string | undefined = undefined;
            let cleanText = data.text;

            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[1]);
                    if (parsed.action === 'addHint') {
                        actionType = 'addHint';
                        actionData = parsed.hint;
                    } else if (parsed.action === 'setDescription') {
                        actionType = 'setDescription';
                        actionData = parsed.description;
                    }
                    cleanText = data.text.replace(jsonMatch[0], '').trim();
                } catch (e) {
                    console.error("Failed to parse AI action");
                }
            }

            setChatHistory(prev => [...prev, {
                role: 'model',
                text: cleanText,
                isAction: !!actionType,
                actionData,
                actionType
            }]);
        } catch (error: any) {
            console.error(error);
            setChatHistory(prev => [...prev, { role: "model", text: `Error: ${error.message}` }]);
        } finally {
            setIsChatting(false);
            chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    };

    const handleAutoGenerateDetails = () => {
        if (!base64) {
            alert("Please upload an image first.");
            return;
        }
        setIsChatting(true);
        setChatHistory(prev => [...prev, { role: "user", text: "✨ Auto-generating hints and description..." }]);
        
        const fd = new FormData();
        fd.append("intent", "analyze");
        fd.append("base64Image", base64);
        if (marker) {
            fd.append("lat", marker.lat.toString());
            fd.append("lng", marker.lng.toString());
        }
        if (evidenceList.length > 0) {
            fd.append("evidenceList", JSON.stringify(evidenceList));
        }
        fetcher.submit(fd, { method: "post" });
    };

    const handleAutoDetectEvidence = async () => {
        if (isChatting || !base64) return;
        
        // VALIDATION: Ensure location is pinned
        if (!marker?.lat || !marker?.lng) {
            setChatHistory(prev => [...prev, { 
                role: "model", 
                text: "⚠️ **Location Required**: Please pin the location on the map first so the AI can ground the evidence against real map data!" 
            }]);
            return;
        }

        setIsChatting(true);
        setChatHistory(prev => [...prev, { role: "user", text: "Please auto-detect evidence for this location." }]);

        const locationPayload = {
            lat: marker?.lat,
            lng: marker?.lng,
            name: photographer
        };

        try {
            let payload: any = { location: locationPayload };
            if (base64.startsWith('http')) {
                payload.imageUrl = base64;
            } else {
                payload.base64Image = base64;
            }

            const res = await fetch("/api/admin/auto-detect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json() as any;
            if (data.error) throw new Error(data.error);

            if (data.evidence && data.evidence.length > 0) {
                const mappedEvidence = data.evidence.map((ev: any) => ({
                    id: Math.random().toString(36).substr(2, 9),
                    description: ev.description,
                    box: {
                        x: ev.box.x,
                        y: ev.box.y,
                        w: ev.box.w,
                        h: ev.box.h
                    }
                }));

                setEvidenceList(prev => [...prev, ...mappedEvidence]);
                setChatHistory(prev => [...prev, { role: "model", text: `✅ Successfully auto-detected ${mappedEvidence.length} evidence markers.` }]);
            } else {
                setChatHistory(prev => [...prev, { role: "model", text: "No distinct evidence landmarks could be automatically detected." }]);
            }
        } catch (e: any) {
            console.error(e);
            setChatHistory(prev => [...prev, { role: "model", text: `⚠️ Auto-detect failed: ${e.message}` }]);
        } finally {
            setIsChatting(false);
            chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    };

    const acceptChatAction = (type: string | undefined, data: any) => {
        if (!type) return;
        if (type === 'addHint') {
            setHintsList(prev => [...prev, data]);
            alert("Hint added to the list!");
        } else if (type === 'setDescription') {
            setTempDesc(data);
            if (!currentBox && !showDescModal) {
                 alert("Copied directly into description input, but draw a box first to save it!");
            }
        }
    };
    // ---------------------------

    // Sync status with AI
    useEffect(() => {
        if (analysis) {
            if (analysis.quality_score) setQualityScore(analysis.quality_score);
            if (analysis.difficulty_rating) setDifficulty(analysis.difficulty_rating);
            if (analysis.precontext) setLocationDescription(analysis.precontext);
            if (analysis.generated_hints && Array.isArray(analysis.generated_hints)) {
                setHintsList(analysis.generated_hints);
            }
            if (analysis.hint_pins && Array.isArray(analysis.hint_pins)) {
                setHintPins(analysis.hint_pins);
            }
            if (isChatting) {
                setChatHistory(prev => [...prev, { role: "model", text: "✅ Successfully auto-generated hints and description." }]);
                setIsChatting(false);
            }
        }
    }, [analysis]);

    // Load existing evidence if needed (Future improvement: Fetch from DB)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Auto-populate photographer attribute with filename (without extension)
            const fileName = file.name.split('.').slice(0, -1).join('.');
            setPhotographer(fileName);

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_SIZE = 1600; // Resize if larger than 1600px

                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG with 0.7 quality
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                    setPreviewUrl(compressedBase64);
                    setBase64(compressedBase64);
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
    };

    const handleBoxDrawn = (box: BoxCoordinates | null) => {
        if (box) {
            setCurrentBox(box);
            setTempDesc("");
            setShowDescModal(true);
        }
    };

    const saveEvidenceItem = () => {
        if (currentBox && tempDesc.trim()) {
            setEvidenceList(prev => [
                ...prev,
                { box: currentBox, description: tempDesc.trim(), id: Math.random().toString(36).substr(2, 9) }
            ]);
            setShowDescModal(false);
            setCurrentBox(null);
        }
    };

    const searchRef = useRef<HTMLInputElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const hintMarkersRef = useRef<any[]>([]);
    const [mapReady, setMapReady] = useState(false);

    useEffect(() => {
        if (!mapsApiKey) return;
        setOptions({ key: mapsApiKey, v: "weekly", libraries: ["places"] }); // Add places library
        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;
            const { Autocomplete } = await importLibrary("places") as google.maps.PlacesLibrary;

            if (mapRef.current) {
                const center = marker || { lat: 22.3193, lng: 114.1694 };
                const mapOptions: google.maps.MapOptions = {
                    center: { lat: 22.3193, lng: 114.1694 }, // Default HK
                    zoom: 11,
                    mapId: "DEMO_MAP_ID",
                    mapTypeId: 'satellite',
                    mapTypeControl: true,
                    disableDefaultUI: false,
                    streetViewControl: false,
                };
                const map = new Map(mapRef.current, mapOptions);
                mapInstanceRef.current = map;

                if (marker) {
                    markerRef.current = new Marker({
                        position: marker,
                        map: map,
                        title: "Target Location",
                    });
                }

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();
                        setMarker({ lat, lng });

                        if (markerRef.current) {
                            markerRef.current.position = e.latLng;
                        } else {
                            markerRef.current = new Marker({
                                position: e.latLng,
                                map: map,
                                title: "Target Location",
                            });
                        }
                    }
                });

                // Setup Autocomplete
                if (searchRef.current) {
                    const autocomplete = new Autocomplete(searchRef.current, {
                        fields: ["geometry", "name"],
                    });
                    autocomplete.bindTo("bounds", map);

                    autocomplete.addListener("place_changed", () => {
                        const place = autocomplete.getPlace();
                        if (!place.geometry || !place.geometry.location) {
                            return;
                        }

                        if (place.geometry.viewport) {
                            map.fitBounds(place.geometry.viewport);
                        } else {
                            map.setCenter(place.geometry.location);
                            map.setZoom(17);
                        }
                    });
                }
                setMapReady(true);
            }
        };
        // Re-run initMap when evidenceStep changes back to false (mounting map)
        if (!evidenceStep) {
            initMap();
        } else {
            setMapReady(false);
            mapInstanceRef.current = null;
        }
    }, [mapsApiKey, evidenceStep]);

    // Hint Pins Renderer
    useEffect(() => {
        let active = true;
        const renderPins = async () => {
            if (!mapReady || !mapInstanceRef.current || evidenceStep) return;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;
            if (!active) return;

            hintMarkersRef.current.forEach(m => m.setMap(null));
            hintMarkersRef.current = [];

            if (hintPins.length > 0) {
                hintPins.forEach((pin, idx) => {
                    const m = new Marker({
                        position: { lat: pin.lat, lng: pin.lng },
                        map: mapInstanceRef.current,
                        title: pin.description,
                        label: { text: "H" + (idx + 1), color: "black", fontWeight: "bold" },
                        icon: 'http://maps.google.com/mapfiles/ms/icons/yellow-dot.png'
                    });
                    hintMarkersRef.current.push(m);
                });
            }
        };
        renderPins();

        return () => { active = false; };
    }, [hintPins, mapReady, evidenceStep, mapsApiKey]);

    // Fullscreen escape key exit and Body Scroll Lock
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isEvidenceFullscreen) {
                setIsEvidenceFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        
        // Lock body scrolling when fullscreen or modal is active (prevents iPad pull-to-refresh / scrolling)
        if (isEvidenceFullscreen || showDescModal) {
            document.body.style.overflow = 'hidden';
            document.body.style.overscrollBehavior = 'none';
        } else {
            document.body.style.overflow = '';
            document.body.style.overscrollBehavior = '';
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
            document.body.style.overscrollBehavior = '';
        };
    }, [isEvidenceFullscreen, showDescModal]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/teacher/dashboard" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back to Dashboard</Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Instructor Protocol: Add Location
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {evidenceList.length > 0 && (
                            <span className="text-green-400 text-sm font-bold flex items-center gap-1">
                                {evidenceList.length} Evidence Points ✅
                            </span>
                        )}
                        {previewUrl && (
                            <button
                                onClick={() => setEvidenceStep(!evidenceStep)}
                                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-all font-bold"
                            >
                                {evidenceStep ? "Return to Editor" : "Manage Evidence"}
                            </button>
                        )}
                    </div>
                </header>

                <div className={`grid grid-cols-1 ${evidenceStep ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-8`}>
                    {!evidenceStep ? (
                        <Form method="post" className="space-y-6 bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl">
                            <input type="hidden" name="base64Image" defaultValue={base64} key={base64 ? 'has-img' : 'no-img'} />
                            <input type="hidden" name="lat" value={marker?.lat ?? ""} />
                            <input type="hidden" name="lng" value={marker?.lng ?? ""} />
                            {/* Send flattened evidence list */}
                            <input type="hidden" name="evidenceList" value={JSON.stringify(evidenceList)} />
                            {existingLocation && <input type="hidden" name="existingId" value={existingLocation.id} />}

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 1: Upload Image</label>
                                {/* ... Image Upload (Same) ... */}
                                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-4 text-center hover:border-slate-700 transition-colors">
                                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="file-upload" />
                                    <label htmlFor="file-upload" className="cursor-pointer">
                                        {previewUrl ? (
                                            <div className="space-y-4">
                                                <img src={previewUrl} className="max-h-48 mx-auto rounded-lg shadow-lg" alt="Preview" />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const fd = new FormData();
                                                        fd.append("intent", "analyze");
                                                        fd.append("base64Image", base64);
                                                        if (marker) {
                                                            fd.append("lat", marker.lat.toString());
                                                            fd.append("lng", marker.lng.toString());
                                                        }
                                                        if (evidenceList.length > 0) {
                                                            fd.append("evidenceList", JSON.stringify(evidenceList));
                                                        }
                                                        fetcher.submit(fd, { method: "post" });
                                                    }}
                                                    disabled={isAnalyzing}
                                                    className="px-4 py-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30 text-xs hover:bg-blue-600/30 transition-all"
                                                >
                                                    {isAnalyzing ? "AI Analyzing..." : "✨ AI Pre-Check"}
                                                </button>
                                                {analysis && (
                                                    <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700 text-left space-y-2 animate-in fade-in slide-in-from-top-2">
                                                        <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">AI Insight</p>
                                                        <p className="text-sm text-slate-200">{analysis.precontext}</p>
                                                        <div className="flex items-center gap-2">
                                                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-bold">
                                                                Score: {analysis.quality_score}
                                                            </span>
                                                            <span className="text-[10px] text-slate-500">{analysis.recommendation}</span>
                                                        </div>
                                                        {analysis.hint_pins && analysis.hint_pins.length > 0 && (
                                                            <p className="text-[10px] text-yellow-400 font-bold mt-2">
                                                                🗺️ {analysis.hint_pins.length} hint pins plotted on the map!
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="py-8">
                                                <p className="text-slate-500">Click to upload image</p>
                                            </div>
                                        )}
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 2: Pinpoint on Map</label>
                                <div className="space-y-2">
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        placeholder="Search area (e.g. 'Tokyo Tower')"
                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} // Prevent form submission
                                    />
                                    <div className="h-64 rounded-2xl overflow-hidden border border-slate-800" ref={mapRef} />
                                </div>
                            </div>

                            {/* Evidence List Preview */}
                            {evidenceList.length > 0 && (
                                <div className="space-y-2 bg-slate-800/30 p-4 rounded-xl border border-slate-700/50">
                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Recorded Evidence</label>
                                    <div className="space-y-2">
                                        {evidenceList.map((ev) => (
                                            <div key={ev.id} className="flex justify-between items-center text-sm p-2 bg-slate-800 rounded-lg">
                                                <span className="truncate flex-1 font-mono text-slate-300 pr-2">{ev.description}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setEvidenceList(prev => prev.filter(e => e.id !== ev.id))}
                                                    className="text-red-400 hover:text-red-300 text-xs font-bold"
                                                >
                                                    REMOVE
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <label className="block text-sm font-medium text-slate-400">Atmospheric Description</label>
                                    <button
                                        type="button"
                                        onClick={handleAutoGenerateDetails}
                                        disabled={isChatting}
                                        className="text-[10px] font-black text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest flex items-center gap-1 active:scale-95 disabled:opacity-50"
                                    >
                                        <span>✨ Auto-Generate Details</span>
                                    </button>
                                </div>
                                <textarea
                                    name="description"
                                    value={locationDescription}
                                    onChange={(e) => setLocationDescription(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none h-24 resize-none"
                                    placeholder="Enter atmospheric description (Informative Snapshot)..."
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 3: Quality & Difficulty</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <p className="text-[10px] uppercase text-slate-500 font-bold">Quality (0-100)</p>
                                        <input
                                            name="qualityScore"
                                            type="number"
                                            value={qualityScore}
                                            onChange={(e) => setQualityScore(parseInt(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[10px] uppercase text-slate-500 font-bold">Difficulty ({marker ? "Selectable" : "Locked"})</p>
                                        <input
                                            name="difficulty"
                                            type="number"
                                            step="0.1"
                                            min="1"
                                            max="10"
                                            value={difficulty}
                                            onChange={(e) => setDifficulty(parseFloat(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-4 pt-4 border-t border-slate-800">
                                <label className="block text-sm font-medium text-slate-400">Extra Data</label>
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="space-y-2">
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <p className="text-[10px] uppercase text-slate-500 font-bold">Hints ({hintsList.length} items)</p>
                                                <button
                                                    type="button"
                                                    onClick={() => setHintsList(prev => [...prev, ""])}
                                                    className="text-xs text-blue-400 font-bold hover:text-blue-300"
                                                >
                                                    + ADD HINT
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                {hintsList.map((hint, idx) => (
                                                    <div key={idx} className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={hint}
                                                            onChange={(e) => {
                                                                const newHints = [...hintsList];
                                                                newHints[idx] = e.target.value;
                                                                setHintsList(newHints);
                                                            }}
                                                            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none"
                                                            placeholder={`Hint #${idx + 1}`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setHintsList(prev => prev.filter((_, i) => i !== idx))}
                                                            className="px-3 text-red-400 hover:bg-slate-800 rounded-xl border border-transparent hover:border-red-900/30"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                {hintsList.length === 0 && (
                                                    <p className="text-xs text-slate-600 italic">No hints added. AI will generate them automatically if pre-check is run.</p>
                                                )}
                                            </div>
                                            {/* Hidden input to send as JSON string */}
                                            <input type="hidden" name="hints" value={JSON.stringify(hintsList)} />
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-[10px] uppercase text-slate-500 font-bold">Photographer Attribute</p>
                                            <input
                                                name="photographer"
                                                type="text"
                                                value={photographer}
                                                onChange={(e) => setPhotographer(e.target.value)}
                                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                                                placeholder="e.g. Unsplash / @username"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-slate-800">
                                <label className="block text-sm font-medium text-slate-400">Assignment</label>
                                <div className="space-y-2">
                                    <p className="text-[10px] uppercase text-slate-500 font-bold">Add to Dataset</p>
                                    <select
                                        name="addToSet"
                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                                    >
                                        <option value="">-- None (Loose Location) --</option>
                                        {mapSets.map((set: any) => (
                                            <option key={set.id} value={set.id}>{set.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <input type="hidden" name="intent" value="deploy" />

                            {actionData?.error && <p className="text-red-400 text-sm">{actionData.error}</p>}
                            {actionData?.success && <p className="text-green-400 text-sm">{actionData.message}</p>}

                            <button
                                type="submit"
                                disabled={isSubmitting || !marker || !previewUrl}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg"
                            >
                                {isSubmitting ? "Saving..." : "Deploy Location"}
                            </button>
                        </Form>
                    ) : (
                        <div className={`lg:col-span-2 bg-slate-900 p-8 rounded-3xl border border-slate-800 ${isEvidenceFullscreen ? 'fixed inset-0 z-[100] m-0 rounded-none bg-black flex flex-col p-4 overscroll-none' : 'min-h-[600px] flex flex-col relative'}`}>
                            <div className="mb-4 flex justify-between items-start">
                                <div>
                                    <h3 className="text-xl font-bold">Mark Identification Area</h3>
                                    <p className="text-slate-500 text-sm">Draw a box around a distinct visual feature (sign, mountain, architecture).</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => setIsEvidenceFullscreen(!isEvidenceFullscreen)}
                                        className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            {isEvidenceFullscreen 
                                                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                            }
                                        </svg>
                                        {isEvidenceFullscreen ? "Exit Fullscreen" : "⛶ Fullscreen Editor"}
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (isEvidenceFullscreen) setIsEvidenceFullscreen(false);
                                            setEvidenceStep(false);
                                        }}
                                        className="text-sm text-blue-400 hover:text-blue-300 font-bold"
                                    >
                                        Done & Return
                                    </button>
                                </div>
                            </div>

                            <div className={`flex-grow relative bg-black rounded-2xl overflow-hidden shadow-2xl ${isEvidenceFullscreen ? 'h-full' : ''}`}>
                                <EvidenceCanvas imageUrl={previewUrl} onBoxChange={handleBoxDrawn} />

                                {/* Overlay existing boxes */}
                                {evidenceList.map(ev => (
                                    <div
                                        key={ev.id}
                                        className="absolute border-2 border-green-400 bg-green-400/10 z-30 group"
                                        style={{
                                            left: `${ev.box.x / 10}%`,
                                            top: `${ev.box.y / 10}%`,
                                            width: `${ev.box.w / 10}%`,
                                            height: `${ev.box.h / 10}%`
                                        }}
                                        title={ev.description}
                                    >
                                        <button
                                            className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600 active:scale-90 z-40"
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onTouchStart={(e) => e.stopPropagation()}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEvidenceList(prev => prev.filter(item => item.id !== ev.id));
                                            }}
                                        >
                                            ×
                                        </button>
                                        <div className="absolute bottom-full left-0 bg-black/70 text-white text-[10px] px-2 py-1 rounded mb-1 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                                            {ev.description}
                                        </div>
                                    </div>
                                ))}

                                {/* Description Prompt Modal */}
                                {showDescModal && (
                                    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in overflow-y-auto overscroll-none" onClick={() => setShowDescModal(false)}>
                                        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 w-full max-w-sm space-y-4 shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
                                            <h4 className="text-lg font-bold text-white">Describe this Evidence</h4>
                                            <p className="text-xs text-slate-400">
                                                How does this feature help identify the location? (e.g., "Unique red roof tiling", "Partial shop sign reading 'Cafe'")
                                            </p>
                                            <textarea
                                                autoFocus
                                                value={tempDesc}
                                                onChange={(e) => setTempDesc(e.target.value)}
                                                className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm focus:border-blue-500 outline-none resize-none"
                                                placeholder="Enter description..."
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setShowDescModal(false)}
                                                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={saveEvidenceItem}
                                                    disabled={!tempDesc.trim()}
                                                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold"
                                                >
                                                    Add Evidence
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {evidenceList.map((ev) => (
                                    <div key={ev.id} className="p-3 bg-slate-800 rounded-xl border border-slate-700 flex flex-col gap-2 relative group">
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs font-bold text-green-400">EVIDENCE</span>
                                            <button
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEvidenceList(prev => prev.filter(e => e.id !== ev.id));
                                                }}
                                                className="text-slate-500 hover:text-red-400 transition-colors p-1"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <p className="text-sm text-slate-300 leading-tight">{ev.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* AI Chat Agent UI */}
                    {evidenceStep && !isEvidenceFullscreen && (
                        <div className="lg:col-span-1 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col h-[600px] shadow-xl overflow-hidden relative">
                            <div className="p-4 border-b border-slate-800 bg-slate-800/50 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                        <h3 className="font-bold text-sm">AI Copilot</h3>
                                    </div>
                                    <select 
                                        className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                                        value={chatModel}
                                        onChange={(e) => setChatModel(e.target.value)}
                                    >
                                        <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                    </select>
                                </div>
                                <button
                                    onClick={handleAutoDetectEvidence}
                                    disabled={isChatting}
                                    className="w-full bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 text-[10px] font-black py-1.5 rounded-lg border border-emerald-500/20 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                                >
                                    <span className={isChatting ? "animate-pulse" : ""}>✨</span>
                                    {isChatting ? "AUTO-DETECTING..." : "AUTO-DETECT MAP EVIDENCE"}
                                </button>
                            </div>

                            <div 
                                ref={chatScrollRef}
                                className="flex-1 overflow-y-auto p-4 space-y-4"
                            >
                                {chatHistory.length === 0 && (
                                    <div className="text-center text-slate-500 text-xs mt-10 space-y-4 flex flex-col items-center">
                                        <div className="space-y-2">
                                            <p>✨ Ready to assist with coordinates and visual analysis.</p>
                                            <p>Try asking: <i>"Give me 3 hints for this place"</i> or <i>"What is visually unique here?"</i></p>
                                        </div>
                                    </div>
                                )}
                                {chatHistory.map((msg, idx) => (
                                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'}`}>
                                            <p className="whitespace-pre-wrap">{msg.text}</p>
                                            
                                            {msg.isAction && msg.actionType && (
                                                <div className="mt-3 bg-slate-900 border border-slate-700 rounded-xl p-3">
                                                    <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Generated Suggestion:</span>
                                                    <p className="text-xs text-slate-300 italic mb-2">"{msg.actionData}"</p>
                                                    <button 
                                                        onClick={() => acceptChatAction(msg.actionType, msg.actionData)}
                                                        className="w-full py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-bold transition-colors"
                                                    >
                                                        {msg.actionType === 'addHint' ? 'Add to Hints' : 'Use Description'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {isChatting && (
                                    <div className="flex justify-start">
                                        <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-none p-3 px-4">
                                            <div className="flex gap-1 items-center">
                                                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                                                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-3 bg-slate-800/50 border-t border-slate-800">
                                <form 
                                    onSubmit={handleChatSubmit}
                                    className="flex gap-2"
                                >
                                    <input 
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        placeholder="Ask for hints, details..."
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm outline-none w-full focus:border-blue-500"
                                        disabled={isChatting}
                                    />
                                    <button 
                                        type="submit"
                                        disabled={isChatting || !chatInput.trim()}
                                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-xl px-3 flex items-center justify-center transition-colors"
                                    >
                                        ➤
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {!evidenceStep && previewUrl && (
                        <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 hidden lg:block">
                            <h3 className="text-slate-400 mb-4 uppercase text-xs tracking-widest font-bold">Live Preview</h3>
                            <div className="aspect-video rounded-2xl overflow-hidden relative group">
                                <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                                <div className="absolute bottom-4 left-4">
                                    <p className="text-xl font-bold">Mystery Location</p>
                                    <div className="text-xs text-green-400 font-mono mt-1 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 relative">
                                            <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-50" />
                                        </span>
                                        {evidenceList.length} VERIFIED CLUES
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
