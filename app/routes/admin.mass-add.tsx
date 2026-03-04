import { useState, useRef, useEffect } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useSubmit, useNavigation, useLoaderData, useNavigate } from 'react-router';
import exifr from 'exifr';
import { useDropzone } from 'react-dropzone';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { EvidenceCanvas } from '~/components/EvidenceCanvas';
import type { BoxCoordinates } from '~/types/shared';
import { analyzeImageQuality } from '~/lib/gemini.server';

// Server-side Action
export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const intent = formData.get('intent');
    const env = context.cloudflare.env as any;

    // 1. AI Analysis
    if (intent === 'analyze') {
        const dataUri = formData.get('image_data') as string;
        if (!dataUri) return Response.json({ error: "No image data provided" }, { status: 400 });

        try {
            const aiData = await analyzeImageQuality(
                env.GEMINI_API_KEY,
                dataUri,
                undefined,
                env.GEMINI_BASE_URL
            );
            return Response.json({ success: true, aiData });
        } catch (e: any) {
            console.error("AI Error:", e);
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    // 2. Final Save
    if (intent === 'save') {
        const db = env.DB as D1Database;
        const bucket = env.ASSETS_BUCKET as R2Bucket;

        const file = formData.get('image') as File;
        const metadataStr = formData.get('metadata') as string;
        const metadata = JSON.parse(metadataStr);

        // Upload to R2
        const key = `locations/${crypto.randomUUID()}.jpg`;
        await bucket.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });
        const publicUrl = `https://assets.hkgeohunter.com/${key}`;

        // Save to D1
        const locationId = `loc_${Math.random().toString(36).substring(2, 9)}`;

        await db.prepare(`
            INSERT INTO locations (
                id, name, description, difficulty_rating, hints, 
                lat, lng, image_url, 
                photographer, quality_score, map_evidence, verified_by_gemini
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(
            locationId,
            metadata.locationName || "New Location",
            metadata.description,
            metadata.difficulty,
            JSON.stringify(metadata.hints),
            metadata.lat,
            metadata.lng,
            publicUrl,
            metadata.photographer,
            metadata.quality_score || 80,
            JSON.stringify(metadata.evidence || [])
        ).run();

        // Add to Dataset if selected
        if (metadata.addToSet) {
            // Check if already in set (unlikely for new loc but good practice)
            const exists = await db.prepare("SELECT 1 FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(metadata.addToSet, locationId).first();
            if (!exists) {
                const max = await db.prepare("SELECT MAX(order_index) as m FROM map_set_items WHERE set_id = ?").bind(metadata.addToSet).first<any>();
                const nextOrder = (max?.m || 0) + 1;
                await db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)").bind(metadata.addToSet, locationId, nextOrder).run();
            }
        }

        return Response.json({ success: true, savedId: key });
    }

    return null;
}

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const { results: mapSets } = await db.prepare("SELECT id, name FROM map_sets ORDER BY created_at DESC").all<any>();

    return {
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        mapSets
    };
}

// Google Maps Libraries
const LIBRARIES: ("places" | "maps" | "marker")[] = ["places", "maps", "marker"];

// Client Component
export default function MassAdd() {
    const { mapsApiKey, mapSets } = useLoaderData<typeof loader>();
    const [files, setFiles] = useState<any[]>([]);
    const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
    const [editingId, setEditingId] = useState<number | null>(null); // Index of file being edited

    // Auto-prompt developer to add map evidence
    useEffect(() => {
        if (files.length === 0 || analyzingIds.size > 0 || editingId !== null) return;
        // Find first file that has AI desc but no evidence and hasn't been prompted
        const indexToPrompt = files.findIndex(f => f.description !== "" && f.evidence.length === 0 && !f.prompted);
        if (indexToPrompt !== -1) {
            setEditingId(indexToPrompt);
            setFiles(prev => {
                const cp = [...prev];
                if (cp[indexToPrompt]) cp[indexToPrompt].prompted = true;
                return cp;
            });
        }
    }, [files, analyzingIds, editingId]);

    const submit = useSubmit();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    // Map Setup
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: mapsApiKey,
        libraries: LIBRARIES
    });

    const analyzeFile = async (fileId: number, fileObj: File) => {
        setAnalyzingIds(prev => new Set(prev).add(fileId));

        const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });

        try {
            const dataUri = await toBase64(fileObj);
            const formData = new FormData();
            formData.append('intent', 'analyze');
            formData.append('image_data', dataUri);

            const res = await fetch('/admin/mass-add', { method: 'POST', body: formData });
            const data = (await res.json()) as { success: boolean, aiData?: any };

            if (data.success && data.aiData) {
                setFiles(prev => prev.map(f => {
                    if (f.id === fileId) {
                        return {
                            ...f,
                            description: data.aiData.precontext,
                            difficulty: data.aiData.difficulty_rating,
                            hints: data.aiData.generated_hints || ["", "", ""],
                            status: f.lat ? 'reviewed' : 'needs_gps'
                        };
                    }
                    return f;
                }));
            }
        } catch (e) {
            console.error("AI Failed for", fileObj.name, e);
        } finally {
            setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(fileId);
                return next;
            });
        }
    };

    const onDrop = async (acceptedFiles: File[]) => {
        const timestamp = Date.now();
        const newFiles = await Promise.all(acceptedFiles.map(async (file, index) => {
            let lat = null, lng = null;
            try {
                // Extract GPS
                const gps = await exifr.gps(file);
                if (gps) {
                    lat = gps.latitude;
                    lng = gps.longitude;
                }
            } catch (e) {
                console.warn("No GPS found for", file.name);
            }

            // Auto sort based on filename matching map set name
            let matchedSet = "";
            const filenameLower = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase() || file.name.toLowerCase();
            if (mapSets) {
                for (const set of mapSets) {
                    if (filenameLower.includes(set.name.toLowerCase()) ||
                        set.name.toLowerCase().includes(filenameLower)) {
                        matchedSet = set.id;
                        break;
                    }
                }
            }

            return {
                id: timestamp + index,
                file,
                preview: URL.createObjectURL(file), // Provide preview
                lat,
                lng,
                photographer: file.name.split('.')[0], // Auto-photographer
                description: "",
                difficulty: 5,
                hints: ["", "", ""],
                evidence: [],
                addToSet: matchedSet, // Set matched set based on filename
                status: lat ? 'analyzing' : 'needs_gps',
                prompted: false // Tracker to avoid repeating the prompt loop
            };
        }));

        // Add to state
        setFiles(prev => [...prev, ...newFiles]);

        // Auto-run AI check
        newFiles.forEach(nf => {
            analyzeFile(nf.id, nf.file);
        });
    };

    const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { 'image/*': [] } });


    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const saveLocation = async (index: number) => {
        const item = files[index];
        if (!item.lat || !item.lng) {
            alert("Missing GPS!");
            return;
        }
        if (item.evidence.length === 0) {
            alert("Please add map evidence and a descriptive visual summary before saving!");
            setEditingId(index);
            return;
        }

        const formData = new FormData();
        formData.append('intent', 'save');
        formData.append('image', item.file);
        formData.append('metadata', JSON.stringify({
            lat: item.lat,
            lng: item.lng,
            description: item.description,
            difficulty: item.difficulty,
            hints: item.hints,
            evidence: item.evidence,
            photographer: item.photographer,
            addToSet: item.addToSet,
            locationName: item.photographer // Use filename as default name
        }));

        const res = await fetch('/admin/mass-add', { method: 'POST', body: formData });
        if (res.ok) {
            removeFile(index); // Remove from list on success
        } else {
            alert("Failed to save");
        }
    };



    // Edit Modal rendering
    const renderEditModal = () => {
        if (editingId === null) return null;
        const item = files[editingId];

        // Local state for evidence description editing inside modal
        const [tempEvidenceBox, setTempEvidenceBox] = useState<BoxCoordinates | null>(null);
        const [tempEvidenceDesc, setTempEvidenceDesc] = useState("");
        const itemsMapRef = useRef<google.maps.Map | null>(null);
        const itemsMarkerRef = useRef<google.maps.Marker | null>(null);
        const searchInputRef = useRef<HTMLInputElement>(null);

        return (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-gray-900 p-6 rounded-xl w-full max-w-5xl max-h-[95vh] overflow-y-scroll border border-gray-800 shadow-2xl">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-white">Edit Location: <span className="text-blue-400">{item.file.name}</span></h2>
                        <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold border border-gray-700">
                            Close & Save
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* LEFT COLUMN: VISUALS */}
                        <div className="space-y-6">
                            <div className="bg-black rounded-2xl overflow-hidden border border-gray-700 relative h-[400px]">
                                <EvidenceCanvas
                                    imageUrl={item.preview}
                                    onBoxChange={(newBox) => {
                                        if (newBox) {
                                            setTempEvidenceBox(newBox);
                                            setTempEvidenceDesc(""); // Reset desc for new box
                                        }
                                    }}
                                >
                                    {/* Render existing evidence */}
                                    {item.evidence.map((ev: any, i: number) => (
                                        <div
                                            key={i}
                                            className="absolute border-2 border-green-400 bg-green-400/10 z-30 group cursor-pointer"
                                            style={{
                                                left: `${ev.box.x / 10}%`,
                                                top: `${ev.box.y / 10}%`,
                                                width: `${ev.box.w / 10}%`,
                                                height: `${ev.box.h / 10}%`
                                            }}
                                            title={ev.description}
                                        >
                                            <button
                                                className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setFiles(prev => {
                                                        const cp = [...prev];
                                                        cp[editingId].evidence = cp[editingId].evidence.filter((_: any, idx: number) => idx !== i);
                                                        return cp;
                                                    });
                                                }}
                                            >
                                                ×
                                            </button>
                                            <div className="absolute bottom-full left-0 bg-black/70 text-white text-xs px-2 py-1 rounded mb-1 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                                                {ev.description}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Modal for adding description to NEW box */}
                                    {tempEvidenceBox && (
                                        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                            <div className="bg-gray-800 p-4 rounded-xl border border-gray-600 w-64 space-y-3 shadow-xl">
                                                <h4 className="font-bold text-sm">Describe Evidence</h4>
                                                <textarea
                                                    autoFocus
                                                    className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                                                    rows={3}
                                                    placeholder="e.g. Red warning sign"
                                                    value={tempEvidenceDesc}
                                                    onChange={(e) => setTempEvidenceDesc(e.target.value)}
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setTempEvidenceBox(null)}
                                                        className="flex-1 py-1.5 bg-gray-700 text-xs rounded hover:bg-gray-600"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (tempEvidenceDesc.trim()) {
                                                                setFiles(prev => {
                                                                    const cp = [...prev];
                                                                    cp[editingId].evidence = [...cp[editingId].evidence, { box: tempEvidenceBox, description: tempEvidenceDesc.trim() }];
                                                                    return cp;
                                                                });
                                                                setTempEvidenceBox(null);
                                                            }
                                                        }}
                                                        disabled={!tempEvidenceDesc.trim()}
                                                        className="flex-1 py-1.5 bg-blue-600 text-xs rounded hover:bg-blue-500 disabled:opacity-50 font-bold"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </EvidenceCanvas>
                            </div>
                            <div className="flex justify-between items-center text-xs text-gray-400">
                                <p>💡 Click and drag to draw evidence boxes.</p>
                                <p>{item.evidence.length} items recorded</p>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: METADATA & MAP */}
                        <div className="space-y-6">
                            {/* Map Section */}
                            <div className="space-y-2">
                                <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider">Location & Coordinates</label>
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Search location (e.g. 'Tokyo Tower')"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none mb-2"
                                />
                                {isLoaded && (
                                    <GoogleMap
                                        mapContainerClassName="w-full h-56 rounded-xl border border-gray-700"
                                        center={item.lat ? { lat: item.lat, lng: item.lng } : { lat: 22.3193, lng: 114.1694 }}
                                        zoom={item.lat ? 16 : 11}
                                        onLoad={map => {
                                            itemsMapRef.current = map;
                                            // Initialize Autocomplete
                                            if (searchInputRef.current && window.google) {
                                                const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current);
                                                autocomplete.bindTo("bounds", map);
                                                autocomplete.addListener("place_changed", () => {
                                                    const place = autocomplete.getPlace();
                                                    if (!place.geometry || !place.geometry.location) return;

                                                    if (place.geometry.viewport) {
                                                        map.fitBounds(place.geometry.viewport);
                                                    } else {
                                                        map.setCenter(place.geometry.location);
                                                        map.setZoom(17);
                                                    }

                                                    // Auto-set marker on search result
                                                    const newLat = place.geometry.location.lat();
                                                    const newLng = place.geometry.location.lng();
                                                    setFiles(prev => {
                                                        const cp = [...prev];
                                                        cp[editingId].lat = newLat;
                                                        cp[editingId].lng = newLng;
                                                        return cp;
                                                    });
                                                });
                                            }
                                        }}
                                        onClick={(e) => {
                                            if (e.latLng) {
                                                setFiles(prev => {
                                                    const cp = [...prev];
                                                    cp[editingId].lat = e.latLng?.lat();
                                                    cp[editingId].lng = e.latLng?.lng();
                                                    return cp;
                                                })
                                            }
                                        }}
                                        options={{
                                            streetViewControl: false,
                                            mapTypeControl: false,
                                            fullscreenControl: false
                                        }}
                                    >
                                        {item.lat && <Marker position={{ lat: item.lat, lng: item.lng }} />}
                                    </GoogleMap>
                                )}
                                <div className="flex gap-2 text-xs text-gray-500 font-mono">
                                    <span>Lat: {item.lat?.toFixed(6) || "N/A"}</span>
                                    <span>Lng: {item.lng?.toFixed(6) || "N/A"}</span>
                                </div>
                            </div>

                            {/* Core Metadata */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider mb-1">Description</label>
                                    <textarea
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none"
                                        rows={3}
                                        value={item.description}
                                        onChange={(e) => setFiles(prev => {
                                            const cp = [...prev];
                                            cp[editingId].description = e.target.value;
                                            return cp;
                                        })}
                                        placeholder="Atmospheric description of the location..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    {/* Photographer */}
                                    <div>
                                        <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider mb-1">Photographer</label>
                                        <input
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none"
                                            value={item.photographer}
                                            onChange={(e) => setFiles(prev => {
                                                const cp = [...prev];
                                                cp[editingId].photographer = e.target.value;
                                                return cp;
                                            })}
                                        />
                                    </div>
                                    {/* Difficulty */}
                                    <div>
                                        <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider mb-1">Difficulty (1-10)</label>
                                        <input
                                            type="number"
                                            min="1" max="10" step="0.5"
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none"
                                            value={item.difficulty}
                                            onChange={(e) => setFiles(prev => {
                                                const cp = [...prev];
                                                cp[editingId].difficulty = parseFloat(e.target.value);
                                                return cp;
                                            })}
                                        />
                                    </div>
                                </div>

                                {/* Dataset Selection */}
                                <div>
                                    <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider mb-1">Add to Map Set (Optional)</label>
                                    <select
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none"
                                        value={item.addToSet || ""}
                                        onChange={(e) => setFiles(prev => {
                                            const cp = [...prev];
                                            cp[editingId].addToSet = e.target.value;
                                            return cp;
                                        })}
                                    >
                                        <option value="">-- Single / Loose Location --</option>
                                        {mapSets?.map((set: any) => (
                                            <option key={set.id} value={set.id}>{set.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Hints Editor */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-gray-400 text-sm font-bold uppercase tracking-wider">Hints</label>
                                        <button
                                            onClick={() => setFiles(prev => {
                                                const cp = [...prev];
                                                cp[editingId].hints.push("");
                                                return cp;
                                            })}
                                            className="text-xs text-blue-400 hover:text-blue-300 font-bold"
                                        >
                                            + ADD HINT
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                        {item.hints.map((hint: string, hIdx: number) => (
                                            <div key={hIdx} className="flex gap-2">
                                                <input
                                                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
                                                    value={hint}
                                                    onChange={(e) => setFiles(prev => {
                                                        const cp = [...prev];
                                                        cp[editingId].hints[hIdx] = e.target.value;
                                                        return cp;
                                                    })}
                                                    placeholder={`Hint #${hIdx + 1}`}
                                                />
                                                <button
                                                    onClick={() => setFiles(prev => {
                                                        const cp = [...prev];
                                                        cp[editingId].hints = cp[editingId].hints.filter((_: any, i: number) => i !== hIdx);
                                                        return cp;
                                                    })}
                                                    className="text-gray-500 hover:text-red-400 px-1"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-950 text-white p-8">
            <h1 className="text-2xl font-bold mb-6">Mass Add Locations</h1>

            <div {...getRootProps()} className="border-2 border-dashed border-gray-700 rounded-xl p-10 text-center hover:border-emerald-500 transition-colors cursor-pointer bg-gray-900/50">
                <input {...getInputProps()} />
                <p className="text-gray-400">Drag & drop files here, or click to select files</p>
                <p className="text-sm text-gray-500 mt-2">Supports JPG, PNG with EXIF awareness</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                {files.map((file, idx) => (
                    <div key={file.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col">
                        <div className="relative h-48 bg-gray-800">
                            <img src={file.preview} className="w-full h-full object-cover opacity-80" />
                            <div className="absolute top-2 right-2 flex gap-1">
                                {file.lat ? (
                                    <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded">GPS Found</span>
                                ) : (
                                    <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded">No GPS</span>
                                )}
                            </div>
                        </div>

                        <div className="p-4 flex-1 space-y-3">
                            <h3 className="font-semibold truncate">{file.file.name}</h3>
                            <p className="text-xs text-gray-400 line-clamp-2">{file.description || "No description generated"}</p>

                            <div className="flex gap-2 text-xs">
                                <span className="bg-gray-800 px-2 py-1 rounded">Diff: {file.difficulty}</span>
                                <span className="bg-gray-800 px-2 py-1 rounded">Ev: {file.evidence.length}</span>
                            </div>
                        </div>

                        <div className="p-3 bg-gray-950/50 flex gap-2 border-t border-gray-800">
                            <button
                                onClick={() => analyzeFile(file.id, file.file)}
                                disabled={analyzingIds.has(file.id)}
                                className="flex-1 px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm disabled:opacity-50"
                            >
                                {analyzingIds.has(file.id) ? 'Thinking...' : 'AI Generate'}
                            </button>
                            <button
                                onClick={() => setEditingId(idx)}
                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                            >
                                Edit
                            </button>
                            {file.evidence.length === 0 ? (
                                <button
                                    onClick={() => setEditingId(idx)}
                                    className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded text-sm text-white font-bold animate-pulse"
                                >
                                    Add Evidence
                                </button>
                            ) : (
                                <button
                                    onClick={() => saveLocation(idx)}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"
                                >
                                    Save
                                </button>
                            )}
                            <button onClick={() => removeFile(idx)} className="px-2 text-gray-500 hover:text-red-400">×</button>
                        </div>
                    </div>
                ))}
            </div>

            {renderEditModal()}
        </div>
    );
}
