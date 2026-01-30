import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData, Link, useFetcher } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";
import { requireDeveloper } from "~/lib/auth.server";
import { analyzeImageQuality } from "~/lib/gemini.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    let existingLocation = null;
    if (id) {
        existingLocation = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first<any>();
    }

    return {
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        existingLocation
    };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    let imageUrl = (formData.get("imageUrl") || formData.get("base64Image")) as string;

    if (intent === "analyze") {
        const env = context.cloudflare.env as any;
        try {
            const analysis = await analyzeImageQuality(env.GEMINI_API_KEY, imageUrl);
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
    const evidenceJson = formData.get("evidence") as string;

    if (!imageUrl || isNaN(lat) || isNaN(lng)) {
        return { error: "Image and coordinates are required" };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const existingId = formData.get("existingId") as string;

    try {
        if (existingId) {
            await db.prepare(
                "UPDATE locations SET image_url = ?, lat = ?, lng = ?, difficulty_rating = ?, quality_score = ? WHERE id = ?"
            ).bind(imageUrl, lat, lng, difficulty, qualityScore, existingId).run();
            return { success: true, message: `Location updated!` };
        } else {
            const id = `loc_${Math.random().toString(36).substring(2, 9)}`;
            await db.prepare(
                "INSERT INTO locations (id, image_url, lat, lng, difficulty_rating, quality_score, verified_by_gemini) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).bind(id, imageUrl, lat, lng, difficulty, qualityScore, 1).run();
            return { success: true, message: `Location added! (ID: ${id})` };
        }
    } catch (e) {
        console.error("Save location error:", e);
        return { error: "Failed to save location" };
    }
}

export default function AddLocation() {
    const { mapsApiKey, existingLocation } = useLoaderData() as any;
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
    const [previewUrl, setPreviewUrl] = useState<string>(existingLocation?.image_url ?? "");
    const [base64, setBase64] = useState<string>(existingLocation?.image_url ?? "");
    const [qualityScore, setQualityScore] = useState<number>(existingLocation?.quality_score ?? 100);
    const [difficulty, setDifficulty] = useState<number>(existingLocation?.difficulty_rating ?? 5);
    const [evidenceStep, setEvidenceStep] = useState(false);
    const [selectedBox, setSelectedBox] = useState<BoxCoordinates | null>(null);

    // Sync status with AI
    useEffect(() => {
        if (analysis?.quality_score) {
            setQualityScore(analysis.quality_score);
        }
        if (analysis?.difficulty_rating) {
            setDifficulty(analysis.difficulty_rating);
        }
    }, [analysis]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setPreviewUrl(result);
                setBase64(result);
            };
            reader.readAsDataURL(file);
        }
    };

    useEffect(() => {
        if (!mapsApiKey) return;
        setOptions({ key: mapsApiKey, v: "weekly" });
        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;
            if (mapRef.current) {
                const center = marker || { lat: 22.3193, lng: 114.1694 };
                const map = new Map(mapRef.current, { center, zoom: marker ? 15 : 11 });

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
            }
        };
        initMap();
    }, [mapsApiKey]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back to Discovery</Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Developer Protocol: Add Location
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {selectedBox && (
                            <span className="text-green-400 text-sm font-bold flex items-center gap-1">
                                Evidence Marked ✅
                            </span>
                        )}
                        {previewUrl && (
                            <button
                                onClick={() => setEvidenceStep(!evidenceStep)}
                                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-all"
                            >
                                {evidenceStep ? "Edit Details" : "Mark Evidence area"}
                            </button>
                        )}
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {!evidenceStep ? (
                        <Form method="post" className="space-y-6 bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl">
                            <input type="hidden" name="base64Image" value={base64} />
                            <input type="hidden" name="lat" value={marker?.lat ?? ""} />
                            <input type="hidden" name="lng" value={marker?.lng ?? ""} />
                            <input type="hidden" name="evidence" value={JSON.stringify(selectedBox)} />
                            {existingLocation && <input type="hidden" name="existingId" value={existingLocation.id} />}

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 1: Upload Image</label>
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
                                <div className="h-64 rounded-2xl overflow-hidden border border-slate-800" ref={mapRef} />
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
                        <div className="lg:col-span-2 bg-slate-900 p-8 rounded-3xl border border-slate-800 min-h-[600px] flex flex-col">
                            <div className="mb-4">
                                <h3 className="text-xl font-bold">Mark Identification Area</h3>
                                <p className="text-slate-500 text-sm">Draw a box over landmarks or text that confirm this location.</p>
                            </div>
                            <div className="flex-grow relative bg-black rounded-2xl overflow-hidden">
                                <EvidenceCanvas imageUrl={previewUrl} onBoxChange={setSelectedBox} />
                            </div>
                            <button
                                onClick={() => setEvidenceStep(false)}
                                className="mt-6 w-full py-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold"
                            >
                                Save Area and Return
                            </button>
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
                                    <p className="text-sm text-slate-400">{marker?.lat.toFixed(4)}, {marker?.lng.toFixed(4)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
