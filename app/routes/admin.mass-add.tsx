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
        const imageFile = formData.get('image') as File;
        if (!imageFile) return Response.json({ error: "No image provided" }, { status: 400 });

        const arrayBuffer = await imageFile.arrayBuffer();
        // Convert to base64 for Gemini
        const base64String = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const dataUri = `data:${imageFile.type};base64,${base64String}`;

        try {
            const aiData = await analyzeImageQuality(
                env.GEMINI_API_KEY,
                dataUri, // Pass direct data URI
                undefined, // No context yet
                env.GEMINI_BASE_URL,
                undefined // Gateway token not strictly needed if base URL is direct or proxy handles it
            );
            return Response.json({ success: true, aiData });
        } catch (e: any) {
            console.error("AI Error:", e);
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    // 2. Final Save (Batch or Single)
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
        const stmt = db.prepare(`
            INSERT INTO locations (
                name, description, difficulty, hints, 
                latitude, longitude, image_url, 
                photographer, quality_score, map_evidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await stmt.bind(
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

        return Response.json({ success: true, savedId: key });
    }

    return null;
}

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    return {
        mapsApiKey: env.GOOGLE_MAPS_API_KEY
    };
}

// Client Component
export default function MassAdd() {
    const { mapsApiKey } = useLoaderData<typeof loader>();
    const [files, setFiles] = useState<any[]>([]);
    const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
    const [editingId, setEditingId] = useState<number | null>(null); // Index of file being edited

    const submit = useSubmit();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();

    // Map Setup
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: mapsApiKey
    });

    const onDrop = async (acceptedFiles: File[]) => {
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

            return {
                id: Date.now() + index,
                file,
                preview: URL.createObjectURL(file), // Provide preview
                lat,
                lng,
                photographer: file.name.split('.')[0], // Auto-photographer
                description: "",
                difficulty: 5,
                hints: ["", "", ""],
                evidence: [],
                status: lat ? 'ready' : 'needs_gps'
            };
        }));

        setFiles(prev => [...prev, ...newFiles]);
    };

    const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { 'image/*': [] } });

    // AI Handler
    const generateAi = async (index: number) => {
        const fileData = files[index];
        setAnalyzingIds(prev => new Set(prev).add(index));

        const formData = new FormData();
        formData.append('intent', 'analyze');
        formData.append('image', fileData.file);

        // We use fetcher to avoid page reload for individual AI calls? 
        // Or just use submit and handle action data?
        // Using fetch for cleaner "component-level" loading state without global nav reload might be better, 
        // but Remix standard is useFetcher.
        // For simplicity let's use standard fetch here to not complexify the actionData routing.

        try {
            const res = await fetch('/admin/mass-add', { method: 'POST', body: formData });
            const data = (await res.json()) as { success: boolean, aiData?: any };

            if (data.success && data.aiData) {
                setFiles(prev => {
                    const copy = [...prev];
                    copy[index] = {
                        ...copy[index],
                        description: data.aiData.precontext,
                        difficulty: data.aiData.difficulty_rating,
                        hints: data.aiData.generated_hints || ["", "", ""],
                        status: copy[index].lat ? 'reviewed' : 'needs_gps'
                    };
                    return copy;
                });
            }
        } catch (e) {
            alert("AI Failed");
        } finally {
            setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(index);
                return next;
            });
        }
    };

    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const saveLocation = async (index: number) => {
        const item = files[index];
        if (!item.lat || !item.lng) {
            alert("Missing GPS!");
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

        return (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-gray-900 p-6 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-scroll">
                    <h2 className="text-xl font-bold mb-4 text-white">Edit Location: {item.file.name}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Image & Evidence */}
                        <div>
                            <label className="block text-gray-400 text-sm mb-2">Draw Evidence</label>
                            <EvidenceCanvas
                                imageUrl={item.preview}
                                onBoxChange={(newBox) => {
                                    if (newBox) {
                                        setFiles(prev => {
                                            const cp = [...prev];
                                            // Add the new box to the evidence list
                                            cp[editingId].evidence = [...cp[editingId].evidence, { box: newBox }];
                                            return cp;
                                        });
                                    }
                                }}
                            >
                                {/* Render existing evidence as overlays */}
                                {item.evidence.map((ev: any, i: number) => (
                                    <div
                                        key={i}
                                        className="absolute border-2 border-emerald-500 bg-emerald-500/20 z-40 group"
                                        style={{
                                            left: `${ev.box.x / 10}%`,
                                            top: `${ev.box.y / 10}%`,
                                            width: `${ev.box.w / 10}%`,
                                            height: `${ev.box.h / 10}%`
                                        }}
                                    >
                                        <button
                                            className="absolute -top-6 right-0 bg-red-600 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent drawing start
                                                setFiles(prev => {
                                                    const cp = [...prev];
                                                    cp[editingId].evidence = cp[editingId].evidence.filter((_: any, idx: number) => idx !== i);
                                                    return cp;
                                                });
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </EvidenceCanvas>
                        </div>

                        {/* Map & Metadata */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-gray-400 text-sm">GPS (Click map to set)</label>
                                {isLoaded && (
                                    <GoogleMap
                                        mapContainerClassName="w-full h-48 rounded border border-gray-700"
                                        center={item.lat ? { lat: item.lat, lng: item.lng } : { lat: 22.3193, lng: 114.1694 }}
                                        zoom={item.lat ? 15 : 11}
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
                                    >
                                        {item.lat && <Marker position={{ lat: item.lat, lng: item.lng }} />}
                                    </GoogleMap>
                                )}
                            </div>

                            <div>
                                <label className="block text-gray-400 text-sm">Description</label>
                                <textarea
                                    className="w-full bg-gray-800 border-gray-700 rounded p-2 text-white"
                                    value={item.description}
                                    onChange={(e) => setFiles(prev => {
                                        const cp = [...prev];
                                        cp[editingId].description = e.target.value;
                                        return cp;
                                    })}
                                />
                            </div>

                            <div className="flex gap-2">
                                <input
                                    className="flex-1 bg-gray-800 border-gray-700 rounded p-2 text-white"
                                    value={item.photographer}
                                    placeholder="Photographer"
                                    onChange={(e) => setFiles(prev => {
                                        const cp = [...prev];
                                        cp[editingId].photographer = e.target.value;
                                        return cp;
                                    })}
                                />
                                <input
                                    type="number"
                                    className="w-20 bg-gray-800 border-gray-700 rounded p-2 text-white"
                                    value={item.difficulty}
                                    onChange={(e) => setFiles(prev => {
                                        const cp = [...prev];
                                        cp[editingId].difficulty = parseInt(e.target.value);
                                        return cp;
                                    })}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-700 rounded text-white hover:bg-gray-600">Done</button>
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
                                onClick={() => generateAi(idx)}
                                disabled={analyzingIds.has(idx)}
                                className="flex-1 px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm disabled:opacity-50"
                            >
                                {analyzingIds.has(idx) ? 'Thinking...' : 'AI Generate'}
                            </button>
                            <button
                                onClick={() => setEditingId(idx)}
                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => saveLocation(idx)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"
                            >
                                Save
                            </button>
                            <button onClick={() => removeFile(idx)} className="px-2 text-gray-500 hover:text-red-400">×</button>
                        </div>
                    </div>
                ))}
            </div>

            {renderEditModal()}
        </div>
    );
}
