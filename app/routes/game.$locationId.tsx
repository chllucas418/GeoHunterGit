import { useRef, useState, useEffect } from "react";
import type { Route } from "./+types/game.$locationId";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, useNavigation } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import { requireUser } from "~/lib/auth.server";
import type { BoxCoordinates, Location } from "~/types/shared";

// Loader to fetch location
export async function loader({ params, request, context }: LoaderFunctionArgs) {
    await requireUser(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY;

    const locationId = params.locationId;
    const loc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(locationId).first<any>();

    if (!loc) {
        throw new Response("Location Not Found", { status: 404 });
    }

    const location: Location = {
        id: loc.id,
        imageUrl: loc.image_url,
        geoPoint: { lat: loc.lat, lng: loc.lng },
        difficultyRating: loc.difficulty_rating,
        qualityScore: loc.quality_score,
        verifiedByGemini: !!loc.verified_by_gemini
    };

    return { location, mapsApiKey: MAPS_API_KEY };
}

export default function GameRoute({ loaderData }: Route.ComponentProps) {
    const { location, mapsApiKey } = loaderData;
    const fetcher = useFetcher() as any;
    const navigation = useNavigation();
    const [evidenceList, setEvidenceList] = useState<{ box: BoxCoordinates; id: string }[]>([]);
    const [currentBox, setCurrentBox] = useState<BoxCoordinates | null>(null);
    const [isEvidenceMode, setIsEvidenceMode] = useState(false);

    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);

    const markerRef = useRef<google.maps.Marker | null>(null);
    const actualMarkerRef = useRef<google.maps.Marker | null>(null);
    const polylineRef = useRef<google.maps.Polyline | null>(null);

    const result = fetcher.data;
    const isSubmitting = fetcher.state !== "idle";
    const isLoading = navigation.state === "loading";

    // --- LAYOUT STATE ---
    // Determine the current layout mode
    // "game": Image 50%, Map 50% (Default)
    // "result": Image 40%, Map 40%, Panel 20% (After submission)
    const layoutMode = result ? "result" : "game";

    // Handle evidence box drawing (Auto-save without description)
    const handleBoxDrawn = (box: BoxCoordinates | null) => {
        if (box) {
            setEvidenceList(prev => [
                ...prev,
                { box, id: Math.random().toString(36).substr(2, 9) }
            ]);
        }
    };

    // Load Maps
    useEffect(() => {
        if (!mapsApiKey) return;

        setOptions({ key: mapsApiKey, v: "weekly" });

        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;

            if (mapRef.current) {
                const map = new Map(mapRef.current, {
                    center: { lat: 22.3193, lng: 114.1694 }, // HK Center
                    zoom: 11,
                    disableDefaultUI: true, // Clean UI
                    mapTypeId: "hybrid",
                    mapId: "DEMO_MAP_ID",
                    gestureHandling: "greedy", // Enable 1-finger pan
                    // Styles removed to prevent conflict with mapId
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng && !result) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();
                        if (markerRef.current) markerRef.current.setMap(null);
                        markerRef.current = new Marker({ position: { lat, lng }, map: map });
                        // Transition to guessing mode on first click if not already
                        setGuess({ lat, lng });
                    }
                });

                setMapInstance(map);
            }
        };

        if (mapsApiKey) initMap();
    }, [mapsApiKey]);

    // Handle results visualization
    useEffect(() => {
        if (!result || !mapInstance || !guess) return;

        const actualCoord = location.geoPoint;

        if (!actualMarkerRef.current) {
            actualMarkerRef.current = new google.maps.Marker({
                position: actualCoord,
                map: mapInstance,
                icon: "https://maps.google.com/mapfiles/ms/icons/green-dot.png", // HTTPS fix
                title: "Actual Location"
            });
        }

        if (!polylineRef.current) {
            polylineRef.current = new google.maps.Polyline({
                path: [guess, actualCoord],
                geodesic: true,
                strokeColor: "#60a5fa", // Blue-400
                strokeOpacity: 0.8,
                strokeWeight: 4,
                map: mapInstance
            });
        }

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(guess);
        bounds.extend(actualCoord);
        // Slightly delay fitting bounds to ensure map is ready
        setTimeout(() => {
            mapInstance.fitBounds(bounds, { top: 100, bottom: 300, left: 100, right: 100 });
        }, 100);

    }, [result, mapInstance, guess, location.geoPoint]);

    // Force Map Resize when switching layout modes
    useEffect(() => {
        if (mapInstance) {
            const timer = setTimeout(() => {
                google.maps.event.trigger(mapInstance, "resize");

                if (result) {
                    // Result Mode adjustments
                    if (guess) {
                        const bounds = new google.maps.LatLngBounds();
                        bounds.extend(guess);
                        bounds.extend(location.geoPoint);
                        mapInstance.fitBounds(bounds, { top: 100, bottom: 100, left: 100, right: 100 });

                        // Draw Result Connection Line
                        if (window.google) {
                            new window.google.maps.Polyline({
                                path: [guess, location.geoPoint],
                                map: mapInstance,
                                geodesic: true,
                                strokeColor: "#3b82f6", // Blue-500
                                strokeOpacity: 0.8,
                                strokeWeight: 4,
                                icons: [{
                                    icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW },
                                    offset: '100%'
                                }]
                            });
                        }
                    }
                } else {
                    // Game Mode adjustments
                    // No specific bounds enforcement needed for default view, 
                    // users can pan freely.
                }
            }, 500); // Wait for transition animation
            return () => clearTimeout(timer);
        }
    }, [layoutMode, mapInstance, result, guess, location]);


    const handleSubmit = () => {
        if (!guess) return;
        const formData = new FormData();
        formData.append("locationId", location.id);
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        // Submit full evidence list
        if (evidenceList.length > 0) {
            formData.append("evidenceList", JSON.stringify(evidenceList));
        }
        fetcher.submit(formData, { method: "post", action: "/api/submit-turn" });
    };

    if (isLoading) {
        return (
            <div className="h-[100dvh] w-screen flex flex-col items-center justify-center bg-black text-white relative overflow-hidden">
                <div className="absolute inset-0 bg-blue-900/10 animate-pulse" />
                <div className="z-10 flex flex-col items-center gap-6">
                    <div className="w-16 h-16 border-4 border-t-blue-500 border-r-transparent border-b-blue-500 border-l-transparent rounded-full animate-spin" />
                    <h2 className="text-2xl font-black uppercase tracking-widest animate-pulse">Establishing Uplink...</h2>
                    <p className="text-xs font-mono text-blue-400/60">Decrypting satellite telemetry</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-[100dvh] w-screen relative overflow-hidden bg-black text-white flex flex-col md:flex-row transition-all duration-700 ease-in-out">

            {/* --- COLUMN 1: IMAGE EVIDENCE --- */}
            <div className={`relative h-full transition-all duration-700 ease-in-out border-r border-white/10 overflow-hidden
                ${layoutMode === "result" ? "w-full md:w-[40%]" : "w-full md:w-1/2"}`
            }
            >

                {/* Mode Toggle Button (Only in game mode) */}
                {!result && !isSubmitting && (
                    <div className="absolute top-24 right-6 z-30 flex flex-col items-end gap-2 pointer-events-auto">
                        <button
                            onClick={() => setIsEvidenceMode(!isEvidenceMode)}
                            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all shadow-xl backdrop-blur-md
                                ${isEvidenceMode
                                    ? 'bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-500/30'
                                    : 'bg-white/10 text-white border-white/10 hover:bg-white/20'
                                }`}
                        >
                            {isEvidenceMode ? "Scanning Mode Active" : "Enable Scanner"}
                        </button>
                        {evidenceList.length > 0 && (
                            <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg border border-white/10 text-xs font-mono text-green-400 animate-in slide-in-from-right">
                                {evidenceList.length} Clues Logged
                            </div>
                        )}
                    </div>
                )}

                <div className={`w-full h-full relative ${isEvidenceMode ? 'cursor-crosshair' : ''}`}>
                    <EvidenceCanvas
                        imageUrl={location.imageUrl}
                        onBoxChange={isEvidenceMode ? handleBoxDrawn : () => { }}
                        disabled={!!result || !isEvidenceMode}
                    >
                        {/* Overlay Player Boxes */}
                        {evidenceList.map((ev, index) => {
                            let borderColor = "border-green-400";
                            let bgColor = "bg-green-400/10";
                            let statusIcon = "";
                            let statusText = null;

                            if (result?.matchedEvidenceIds && result.adminEvidence) {
                                if (result.fullFeedback?.results) {
                                    const feedback = result.fullFeedback.results.find((r: any) => r.index === index);
                                    if (feedback && feedback.validity > 0.7) {
                                        borderColor = "border-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.6)]";
                                        bgColor = "bg-blue-400/20";
                                        statusIcon = "✓";
                                        statusText = "VALID CLUE";
                                    } else {
                                        borderColor = "border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]";
                                        bgColor = "bg-red-500/10";
                                        statusIcon = "✕";
                                        statusText = "IGNORED";
                                    }
                                }
                            }

                            return (
                                <div
                                    key={ev.id}
                                    className={`absolute border-2 ${borderColor} ${bgColor} transition-all duration-500 flex flex-col items-end p-1 animate-in zoom-in-50 cursor-pointer group hover:bg-green-400/20`}
                                    style={{
                                        left: `${ev.box.x / 10}%`,
                                        top: `${ev.box.y / 10}%`,
                                        width: `${ev.box.w / 10}%`,
                                        height: `${ev.box.h / 10}%`
                                    }}
                                >
                                    {result && statusText && (
                                        <div className={`text-[10px] font-black px-2 py-0.5 rounded-sm backdrop-blur-md uppercase tracking-wider
                                            ${statusIcon === "✓" ? "bg-blue-500 text-white" : "bg-red-500 text-white"}`}>
                                            {statusIcon} {statusText}
                                        </div>
                                    )}
                                    {!result && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEvidenceList(prev => prev.filter(item => item.id !== ev.id));
                                            }}
                                            className="bg-red-500 text-white w-5 h-5 flex items-center justify-center text-xs font-bold rounded hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Remove Evidence"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {/* Overlay ADMIN Verified Boxes (Result Mode Only) */}
                        {result && result.adminEvidence && result.adminEvidence.map((ev: any) => {
                            let box: BoxCoordinates;
                            try {
                                const rawBox = ev.box || ev.bounding_box;
                                box = typeof rawBox === 'string' ? JSON.parse(rawBox) : rawBox;
                            } catch (e) { return null; }

                            if (!box) return null;

                            return (
                                <div
                                    key={`admin-${ev.id}`}
                                    className="absolute border-2 border-yellow-400 bg-yellow-400/10 transition-all duration-500 flex flex-col items-start p-1 animate-in zoom-in-50 z-20"
                                    style={{
                                        left: `${box.x / 10}%`,
                                        top: `${box.y / 10}%`,
                                        width: `${box.w / 10}%`,
                                        height: `${box.h / 10}%`
                                    }}
                                >
                                    <div className="text-[10px] font-black px-2 py-0.5 rounded-sm backdrop-blur-md bg-yellow-500 text-black uppercase tracking-wider shadow-lg">
                                        ★ OFFICIAL INTEL
                                    </div>
                                </div>
                            );
                        })}
                    </EvidenceCanvas>
                </div>

                <div className="absolute top-0 left-0 p-6 z-10 w-full bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                    <div className="flex justify-between items-start pointer-events-auto">
                        <Link to="/" className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-xs font-bold transition-all border border-white/10">
                            ← ABORT MISSION
                        </Link>
                        <div className="text-right">
                            {/* Only show target name as simplified header */}
                            <h1 className="text-3xl font-black tracking-tighter">TARGET #{location.id.slice(-4).toUpperCase()}</h1>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- COLUMN 2: MAP --- */}
            <div className={`transition-all duration-700 ease-in-out bg-slate-900 overflow-hidden relative border-r border-white/10
                 ${layoutMode === "result" ? "relative w-full md:w-[40%] h-full" : "relative w-full md:w-1/2 h-full"}`
            }
            >

                <div ref={mapRef} className="w-full h-full" />

                {/* Floating Map Controls (Game Mode) */}
                {!result && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xs px-4">
                        <button
                            onClick={handleSubmit}
                            disabled={!guess || isSubmitting}
                            className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all border border-white/10 backdrop-blur-xl
                                ${guess
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white translate-y-0 opacity-100'
                                    : 'bg-black/40 text-white/20 translate-y-10 opacity-0 pointer-events-none'
                                }
                            `}
                        >
                            {isSubmitting ? "CALCULATING..." : "CONFIRM COORDINATES"}
                        </button>
                    </div>
                )}
            </div>

            {/* --- COLUMN 3: PANEL (RESULTS) --- */}
            <div className={`transition-all duration-700 ease-in-out bg-slate-950 flex flex-col h-full overflow-hidden
                 ${layoutMode === "result" ? "w-full md:w-[20%] opacity-100" : "w-0 opacity-0 pointer-events-none"}`}
            >
                {/* Stats Header */}
                {result && (
                    <>
                        <div className="p-6 border-b border-white/10 bg-slate-900/50 shrink-0 animate-in slide-in-from-right duration-500">
                            <div className="mb-4">
                                <h2 className="text-5xl font-black text-white tracking-tighter leading-none">{result.score}</h2>
                                <p className="text-[10px] font-mono text-green-400 uppercase tracking-widest">Mission Score</p>
                            </div>
                            <div className="flex justify-between items-end">
                                <div>
                                    <h3 className="text-xl font-bold text-white">{Math.round(result.distance)}<span className="text-sm font-normal text-slate-500">m</span></h3>
                                    <p className="text-[10px] font-mono text-slate-500 uppercase">Deviation</p>
                                </div>
                                {result.aiBonus > 0 && (
                                    <div className="text-right">
                                        <h3 className="text-xl font-bold text-blue-400">+{result.aiBonus}</h3>
                                        <p className="text-[10px] font-mono text-blue-500/70 uppercase">Intel Bonus</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-6 animate-in slide-in-from-right duration-700 delay-100">
                            {/* ... Intel List ... */}
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Geographic Intel</h4>
                                    <div className="space-y-2">
                                        {result.adminEvidence && result.adminEvidence.length > 0 ? (
                                            result.adminEvidence.map((ev: any) => {
                                                const isFound = result.matchedEvidenceIds?.includes(ev.id);
                                                return (
                                                    <div key={ev.id} className={`p-3 rounded-xl border ${isFound ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-900 border-white/5'} transition-all`}>
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className={`text-[10px] font-black uppercase ${isFound ? 'text-green-400' : 'text-slate-500'}`}>
                                                                {isFound ? "ACQUIRED" : "MISSED"}
                                                            </span>
                                                        </div>
                                                        <p className={`text-xs ${isFound ? 'text-white' : 'text-slate-500'}`}>{ev.description}</p>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-xs text-slate-500 italic">No intelligence data available for this sector.</p>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">AI Analysis</h4>
                                    <div className="space-y-3">
                                        {result.fullFeedback?.results && result.fullFeedback.results.length > 0 ? (
                                            result.fullFeedback.results.map((item: any, i: number) => (
                                                <div key={i} className="text-xs text-slate-300 border-l-2 border-blue-500/50 pl-3 py-1">
                                                    <div className="flex justify-between">
                                                        <span className="font-bold text-blue-400 block mb-1">{item.description}</span>
                                                        <span className="text-[10px] font-mono opacity-50">CONF: {Math.round(item.validity * 100)}%</span>
                                                    </div>
                                                    <p className="opacity-80 leading-snug">{item.explanation}</p>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-xs leading-relaxed text-slate-300 italic">
                                                {result.aiFeedback?.explanation || "Searching for correlations..."}
                                            </p>
                                        )}
                                    </div>
                                    {result.aiBonus > 0 && (
                                        <div className="mt-3 py-2 px-3 bg-blue-500/20 rounded-lg border border-blue-500/30 flex justify-between items-center">
                                            <span className="text-xs font-bold text-blue-300">New Discovery Bonus</span>
                                            <span className="font-mono text-blue-400 font-bold">+{result.aiBonus}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <Link to="/" className="w-full py-4 bg-white text-black font-black uppercase tracking-widest text-center rounded-xl hover:bg-slate-200 transition-colors shadow-lg mt-auto">
                                Next Deployment
                            </Link>
                        </div>
                    </>
                )}
            </div>

        </div>
    );
}
