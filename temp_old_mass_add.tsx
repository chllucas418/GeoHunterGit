import { useState, useRef, useEffect } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useSubmit, useNavigation, useLoaderData, useNavigate } from 'react-router';
import { useDropzone } from 'react-dropzone';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { EvidenceCanvas } from '~/components/EvidenceCanvas';
import type { BoxCoordinates } from '~/types/shared';



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
            setFiles((prev: any[]) => {
                const cp = [...prev];
                if (cp[indexToPrompt]) cp[indexToPrompt].prompted = true;
                return cp;
            });
        }
    }, [files, analyzingIds, editingId]);

    const navigation = useNavigation();

    // Map Setup
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: mapsApiKey || "",
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
            
            // Send location data and evidence if available
            const fileItem = files.find(f => f.id === fileId);
            if (fileItem && fileItem.lat && fileItem.lng) {
                formData.append('lat', String(fileItem.lat));
                formData.append('lng', String(fileItem.lng));
            }
            if (fileItem && fileItem.evidence && fileItem.evidence.length > 0) {
                formData.append('evidence', JSON.stringify(fileItem.evidence));
            }

            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
            console.log("[MassAdd] AI Analysis response received", res.status);
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const data = (await res.json()) as { success: boolean, aiData?: any, error?: string };
                console.log("[MassAdd] AI Data:", data);
                if (data.success && data.aiData) {
                    setFiles((prev: any[]) => prev.map(f => {
                        if (f.id === fileId) {
                            return {
                                ...f,
                                description: data.aiData.precontext || data.aiData.description || "",
                                difficulty: data.aiData.difficulty_rating || 5,
                                hints: Array.isArray(data.aiData.generated_hints) ? data.aiData.generated_hints :
                                       Array.isArray(data.aiData.hints) ? data.aiData.hints : 
                                       ["", "", ""],
                                status: f.lat ? 'reviewed' : 'needs_gps'
                            };
                        }
                        return f;
                    }));
                } else if (data.error) {
                    throw new Error(data.error);
                }
            } else {
                const text = await res.text();
                throw new Error(`Server returned non-JSON response: ${res.status} ${res.statusText}. Response text partial: ${text.substring(0, 100)}`);
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
                // Extract GPS dynamically to avoid SSR crashes
                const exifr = await import('exifr');
                const gps = await exifr.default.gps(file);
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
        setFiles((prev: any[]) => [...prev, ...newFiles]);

        // Note: AI analysis no longer auto-triggers here to ensure location is set first by user
    };

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        accept: { 'image/*': [] }
    } as any);


    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const saveLocation = async (index: number, autoAdvance: boolean = false) => {
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

        const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
        if (res.ok) {
            const nextIdx = index < files.length - 1 ? index : (index > 0 ? index - 1 : null);
            removeFile(index); // Remove from list on success
            if (autoAdvance && nextIdx !== null) {
                // If we were editing, potentially stay in modal for next item
                if (editingId !== null) {
                    setEditingId(nextIdx);
                }
            } else if (editingId === index) {
                setEditingId(null);
            }
        } else {
            alert("Failed to save");
        }
    };



    ;

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
                            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                                {file.lat ? (
                                    <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded whitespace-nowrap">GPS Found</span>
                                ) : (
                                    <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded whitespace-nowrap">No GPS</span>
                                )}
                                {file.evidence.length > 0 && (
                                    <span className="bg-amber-500/90 text-black font-black text-[10px] px-2 py-1 rounded shadow-lg animate-pulse uppercase tracking-tighter whitespace-nowrap border border-black/10">
                                        ΓÜí {file.evidence.length} Evidence!
                                    </span>
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
                            <button onClick={() => removeFile(idx)} className="px-2 text-gray-500 hover:text-red-400">├ù</button>
                        </div>
                    </div>
                ))}
            </div>

            <EditModal editingId={editingId} files={files} setFiles={setFiles} setEditingId={setEditingId} isLoaded={isLoaded} mapSets={mapSets} onSave={saveLocation} />
        </div>
    );
}


export function EditModal({ editingId, files, setFiles, setEditingId, isLoaded, mapSets, onSave }: any) {
    if (editingId === null) return null;
    const item = files[editingId];

    // Local state for evidence description editing inside modal
    const [tempEvidenceBox, setTempEvidenceBox] = useState<BoxCoordinates | null>(null);
    const [tempEvidenceDesc, setTempEvidenceDesc] = useState("");
    const itemsMapRef = useRef<google.maps.Map | null>(null);
    const itemsMarkerRef = useRef<google.maps.Marker | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // AI Copilot State
    const [chatHistory, setChatHistory] = useState<any[]>([]);
    const [chatMessage, setChatMessage] = useState("");
    const [isChatting, setIsChatting] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Resizer logic
    const [splitRatio, setSplitRatio] = useState(35);
    const [isResizing, setIsResizing] = useState(false);
    const [isEvidenceFullscreen, setIsEvidenceFullscreen] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem("geohunter-mass-add-split");
        if (saved) setSplitRatio(parseFloat(saved));
    }, []);

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        // Calculate relative to the actual modal container if possible, but window-relative is fine for h-split if max-w-vw
        const newRatio = (1 - (e.clientX / window.innerWidth)) * 100;
        setSplitRatio(Math.min(Math.max(newRatio, 15), 75)); // Expanded range 15% - 75%
    };

    const handleMouseUp = () => {
        setIsResizing(false);
        localStorage.setItem("geohunter-mass-add-split", splitRatio.toString());
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isEvidenceFullscreen) {
                setIsEvidenceFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isEvidenceFullscreen]);

    const handleChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatMessage.trim() || isChatting) return;

        const userMsg = chatMessage;
        setChatMessage("");
        setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsChatting(true);

        const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });

        try {
            const dataUri = await toBase64(item.file);
            const formData = new FormData();
            formData.append('intent', 'chat');
            formData.append('message', userMsg);
            formData.append('history', JSON.stringify(chatHistory));
            formData.append('image_data', dataUri);
            if (item.lat && item.lng) {
                formData.append('lat', String(item.lat));
                formData.append('lng', String(item.lng));
            }
            if (item.evidence && item.evidence.length > 0) {
                formData.append('evidence', JSON.stringify(item.evidence));
            }
            formData.append('current_description', item.description || "");
            formData.append('current_hints', JSON.stringify(item.hints || []));

            const res = await fetch('/api/admin/mass-add', { method: 'POST', body: formData });
            const data = (await res.json()) as any;

            if (data.success) {
                setChatHistory(prev => [...prev, { role: 'model', content: data.ai_response }]);
            } else {
                setChatHistory(prev => [...prev, { role: 'model', content: "Error: " + data.error }]);
            }
        } catch (error) {
            console.error("Chat error", error);
            setChatHistory(prev => [...prev, { role: 'model', content: "Failed to communicate with AI." }]);
        } finally {
            setIsChatting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center overflow-hidden">
            <div className="bg-gray-900 rounded-2xl w-full h-[95vh] mx-4 max-w-[98vw] flex flex-col border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="p-1.5 bg-blue-600/20 rounded-lg text-blue-400">≡ƒôì</span>
                            Edit Location: <span className="text-blue-400 font-mono ml-2">{item.file.name}</span>
                        </h2>
                        {/* Navigation */}
                        <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                            <button 
                                onClick={() => setEditingId(Math.max(0, editingId - 1))}
                                disabled={editingId === 0}
                                className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold border-r border-gray-700 transition-colors"
                            >
                                ΓåÉ PREV
                            </button>
                            <span className="px-3 py-1.5 text-[10px] font-mono text-gray-400">
                                {editingId + 1} / {files.length}
                            </span>
                            <button 
                                onClick={() => setEditingId(Math.min(files.length - 1, editingId + 1))}
                                disabled={editingId === files.length - 1}
                                className="px-3 py-1.5 hover:bg-gray-700 disabled:opacity-20 text-xs font-bold transition-colors"
                            >
                                NEXT ΓåÆ
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => setIsEvidenceFullscreen(!isEvidenceFullscreen)}
                            className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all border flex items-center gap-2 ${
                                isEvidenceFullscreen 
                                ? "bg-amber-600/20 border-amber-500/50 text-amber-400 hover:bg-amber-600/30" 
                                : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white"
                            }`}
                        >
                            {isEvidenceFullscreen ? "ΓÅ╣ Exit Fullscreen" : "Γ¢╢ Fullscreen Editor"}
                        </button>
                        <button 
                            disabled={isSaving}
                            onClick={async () => {
                                setIsSaving(true);
                                await onSave(editingId, true);
                                setIsSaving(false);
                            }}
                            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-black text-xs uppercase tracking-widest shadow-[0_4px_15px_rgba(16,185,129,0.3)] transition-all flex items-center gap-2"
                        >
                            {isSaving ? "SAVING..." : "≡ƒÆ╛ Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-bold border border-gray-700 text-xs uppercase tracking-widest">
                            Exit
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* LEFT PANEL: CONTENT EDITOR */}
                    <div 
                        className={`flex-1 overflow-y-auto p-8 custom-scrollbar bg-gray-900/30 transition-all ${isEvidenceFullscreen ? 'fixed inset-0 z-[60] bg-gray-950 p-0' : ''}`} 
                        style={isEvidenceFullscreen ? {} : { width: `${100 - splitRatio}%` }}
                    >
                        <div className={`${isEvidenceFullscreen ? 'w-full h-full' : 'max-w-4xl mx-auto space-y-10 pb-20'}`}>
                            {/* Visuals Section */}
                            <div className={`${isEvidenceFullscreen ? 'w-full h-full' : 'grid grid-cols-1 gap-6'}`}>
                        <div className={`${isEvidenceFullscreen ? 'w-full h-full rounded-none border-none' : 'bg-black rounded-2xl overflow-hidden border border-gray-700 relative h-[400px]'}`}>
                            {isEvidenceFullscreen && (
                                <button 
                                    onClick={() => setIsEvidenceFullscreen(false)}
                                    className="absolute top-6 right-6 z-[70] p-3 bg-red-600/80 hover:bg-red-600 text-white rounded-full shadow-2xl transition-all"
                                    title="Close Fullscreen (Esc)"
                                >
                                    <span className="text-xl font-bold">├ù</span>
                                </button>
                            )}
                            <EvidenceCanvas
                                imageUrl={item.preview}
                                onBoxChange={(newBox) => {
                                    if (newBox) {
                                        setTempEvidenceBox(newBox);
                                        setTempEvidenceDesc(""); // Reset desc for new box
                                    }
                                }}
                            >
                                {/* Evidence Banner */}
                                {item.evidence.length > 0 && (
                                    <div className="absolute top-4 left-4 z-40">
                                        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-black px-4 py-1.5 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center gap-2 border border-amber-400/50">
                                            <span className="text-lg animate-bounce">≡ƒöÑ</span>
                                            <span className="font-black text-xs uppercase tracking-widest italic">
                                                {item.evidence.length >= 2 
                                                    ? `INTEL OVERLOAD: ${item.evidence.length} EVIDENCE MARKERS DETECTED!` 
                                                    : `CRITICAL INTEL: ${item.evidence.length} EVIDENCE MARKER FOUND!`}
                                            </span>
                                        </div>
                                    </div>
                                )}

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
                                                setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].evidence = cp[editingId].evidence.filter((_: any, idx: number) => idx !== i);
                                                    return cp;
                                                });
                                            }}
                                        >
                                            ├ù
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
                                                            setFiles((prev: any[]) => {
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
                            <p>≡ƒÆí Click and drag to draw evidence boxes.</p>
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
                                    onLoad={(map: google.maps.Map) => {
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
                                                setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].lat = newLat;
                                                    cp[editingId].lng = newLng;
                                                    return cp;
                                                });
                                            });
                                        }
                                    }}
                                    onClick={(e: google.maps.MapMouseEvent) => {
                                        if (e.latLng) {
                                            setFiles((prev: any[]) => {
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
                                        fullscreenControl: true,
                                        gestureHandling: 'greedy'
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
                                    onChange={(e) => setFiles((prev: any[]) => {
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
                                        onChange={(e) => setFiles((prev: any[]) => {
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
                                        onChange={(e) => setFiles((prev: any[]) => {
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
                                    onChange={(e) => setFiles((prev: any[]) => {
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
                                        onClick={() => setFiles((prev: any[]) => {
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
                                                onChange={(e) => setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].hints[hIdx] = e.target.value;
                                                    return cp;
                                                })}
                                                placeholder={`Hint #${hIdx + 1}`}
                                            />
                                            <button
                                                onClick={() => setFiles((prev: any[]) => {
                                                    const cp = [...prev];
                                                    cp[editingId].hints = cp[editingId].hints.filter((_: any, i: number) => i !== hIdx);
                                                    return cp;
                                                })}
                                                className="text-gray-500 hover:text-red-400 px-1"
                                            >
                                                ├ù
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* RESIZER DRAG HANDLE */}
                    {!isEvidenceFullscreen && (
                        <div 
                            onMouseDown={() => setIsResizing(true)}
                            className={`w-1.5 hover:w-2.5 bg-blue-500/5 hover:bg-blue-500/30 cursor-col-resize transition-all relative group z-20 flex items-center justify-center ${isResizing ? 'bg-blue-500/50 w-2.5' : ''}`}
                        >
                            <div className="h-10 w-1 bg-gray-700/50 rounded-full group-hover:bg-blue-400/50 transition-colors" />
                            {/* Visual grab handle lines */}
                            <div className="absolute flex flex-col gap-1 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-0.5 h-0.5 bg-blue-400 rounded-full" />
                                <div className="w-0.5 h-0.5 bg-blue-400 rounded-full" />
                                <div className="w-0.5 h-0.5 bg-blue-400 rounded-full" />
                            </div>
                        </div>
                    )}

                    {/* RIGHT PANEL: AI COPILOT */}
                    {!isEvidenceFullscreen && (
                        <div className="bg-gray-950 flex flex-col h-full border-l border-gray-800 flex-shrink-0" style={{ width: `${splitRatio}%` }}>
                            <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-black/40">
                            <h3 className="text-sm font-black bg-gradient-to-r from-blue-400 to-purple-400 text-transparent bg-clip-text uppercase tracking-widest flex items-center gap-2">
                                <span>Γ£¿</span> AI Copilot (v2.2)
                            </h3>
                            <div className="text-[10px] text-gray-500 font-mono">Resizable Panel</div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
                            {chatHistory.length === 0 ? (
                                <div className="text-center text-gray-500 my-auto pt-20">
                                    <p>Ask the AI copilot to generate descriptions, suggest hints, or identify landmarks!</p>
                                    <p className="text-xs mt-2">Example: "Generate a creepy description based on the evidence boxes."</p>
                                </div>
                            ) : (
                                chatHistory.map((msg, i) => (
                                    <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200 border border-gray-700'}`}>
                                            <p className="whitespace-pre-wrap text-sm">{msg.content.replace(/```json[\s\S]*?```/g, "").trim()}</p>
                                        </div>
                                        {/* Parse actions from message */}
                                        {msg.role === 'model' && msg.content.includes("```json") && (
                                            <div className="mt-3 space-y-4 w-full max-w-[95%] animate-in fade-in slide-in-from-top-3">
                                                {Array.from(msg.content.matchAll(/```json([\s\S]*?)```/g)).map((match: any, mIdx: number) => {
                                                    try {
                                                        const jsonStr = match[1].trim();
                                                        const action = JSON.parse(jsonStr);
                                                        
                                                        const renderPreview = (data: any) => {
                                                            if (!data) return "N/A";
                                                            if (typeof data === 'string') return data;
                                                            if (Array.isArray(data)) return (
                                                                <ul className="list-disc list-inside space-y-1">
                                                                    {data.map((item, i) => <li key={i}>{String(item)}</li>)}
                                                                </ul>
                                                            );
                                                            return <pre className="text-[10px] overflow-x-auto bg-black/40 p-2 rounded border border-white/5">{JSON.stringify(data, null, 2)}</pre>;
                                                        };

                                                        // Consolidated Metadata (The "Full Bracket")
                                                        if (action.action === "suggestFullMetadata" || (action.description && action.hints)) {
                                                            const desc = action.data?.description || action.description;
                                                            const hnts = action.data?.hints || action.hints;
                                                            return (
                                                                <div key={mIdx} className="bg-slate-900 border-2 border-indigo-500/50 rounded-2xl p-4 shadow-2xl relative overflow-hidden group">
                                                                    <div className="absolute top-0 right-0 p-2 opacity-20 text-[10px] font-mono">v2.2</div>
                                                                    <div className="flex items-center gap-2 mb-4">
                                                                        <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400">Γ£¿</div>
                                                                        <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em]">Full Metadata Suggestion</h4>
                                                                    </div>
                                                                    
                                                                    <div className="space-y-4 mb-5">
                                                                        <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                                                                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-2">Refined Description:</p>
                                                                            <p className="text-sm text-slate-200 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3">"{desc}"</p>
                                                                        </div>
                                                                        <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                                                                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-2">Subtle Hints:</p>
                                                                            <div className="text-xs text-slate-300 space-y-1">{renderPreview(hnts)}</div>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <button
                                                                        onClick={() => setFiles((prev: any[]) => {
                                                                            const cp = [...prev];
                                                                            if (desc) cp[editingId].description = desc;
                                                                            if (hnts) cp[editingId].hints = Array.isArray(hnts) ? hnts : [hnts];
                                                                            return cp;
                                                                        })}
                                                                        className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-black px-4 py-3.5 rounded-xl shadow-[0_5px_15px_rgba(99,102,241,0.4)] transition-all transform hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2"
                                                                    >
                                                                        ≡ƒÜÇ APPLY FULL REFINEMENT
                                                                    </button>
                                                                </div>
                                                            );
                                                        }

                                                        if (action.action === "setHints") {
                                                            return (
                                                                <div key={mIdx} className="bg-slate-900 border-2 border-purple-500/50 rounded-2xl p-4 shadow-xl">
                                                                    <div className="flex items-center gap-2 mb-4">
                                                                        <div className="p-1.5 bg-purple-500/20 rounded-lg text-purple-400">≡ƒô¥</div>
                                                                        <h4 className="text-xs font-black text-purple-400 uppercase tracking-widest">Hints Suggestion (v2.2)</h4>
                                                                    </div>
                                                                    <div className="text-sm text-slate-200 mb-5 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
                                                                        {renderPreview(action.data)}
                                                                    </div>
                                                                    <button
                                                                        onClick={() => setFiles((prev: any[]) => {
                                                                            const cp = [...prev];
                                                                            cp[editingId].hints = Array.isArray(action.data) ? action.data : [action.data];
                                                                            return cp;
                                                                        })}
                                                                        className="w-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-4 py-3 rounded-xl transition-all shadow-lg active:scale-95"
                                                                    >
                                                                        Apply Hints
                                                                    </button>
                                                                </div>
                                                            );
                                                        }
                                                        if (action.action === "setDescription") {
                                                            return (
                                                                <div key={mIdx} className="bg-slate-900 border-2 border-blue-500/50 rounded-2xl p-4 shadow-xl">
                                                                    <div className="flex items-center gap-2 mb-4">
                                                                        <div className="p-1.5 bg-blue-500/20 rounded-lg text-blue-400">≡ƒôû</div>
                                                                        <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest">Description Suggestion (v2.2)</h4>
                                                                    </div>
                                                                    <div className="text-sm text-slate-200 mb-5 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5 italic">
                                                                        "{renderPreview(action.data)}"
                                                                    </div>
                                                                    <button
                                                                        onClick={() => setFiles((prev: any[]) => {
                                                                            const cp = [...prev];
                                                                            cp[editingId].description = action.data;
                                                                            return cp;
                                                                        })}
                                                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-3 rounded-xl transition-all shadow-lg active:scale-95"
                                                                    >
                                                                        Apply Description
                                                                    </button>
                                                                </div>
                                                            );
                                                        }
                                                    } catch (e) { 
                                                        return (
                                                            <div key={mIdx} className="text-[10px] text-red-400 bg-red-900/10 p-4 rounded-xl border border-red-500/30">
                                                                ΓÜá∩╕Å Parsing Failure in JSON block.
                                                            </div>
                                                        ); 
                                                    }
                                                    return null;
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                            {isChatting && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-800 text-gray-400 rounded-2xl px-4 py-2 text-sm border border-gray-700 flex items-center gap-2">
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                        <form onSubmit={handleChat} className="p-3 bg-gray-900 border-t border-gray-800 flex gap-2">
                            <input
                                type="text"
                                className="flex-1 bg-gray-800 border-none rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none placeholder-gray-500"
                                placeholder="Chat with AI..."
                                value={chatMessage}
                                onChange={(e) => setChatMessage(e.target.value)}
                                disabled={isChatting}
                            />
                            <button
                                type="submit"
                                disabled={isChatting || !chatMessage.trim()}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:bg-gray-700 text-white font-bold rounded-lg transition-colors text-sm"
                            >
                                Send
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    </div>
);
}
