import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireUser } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";

export async function loader({ request, params, context }: any) {
    const userId = await requireUser(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    return { code, userId, mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export default function StudentLiveGame() {
    const { code, mapsApiKey } = useLoaderData() as any;
    const fetcher = useFetcher();
    const actionFetcher = useFetcher();
    // const navigation = useNavigation(); // Not really navigating, just polling

    const [roomState, setRoomState] = useState<any>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [guess, setGuess] = useState<{ lat: number, lng: number } | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [result, setResult] = useState<any>(null);
    const lastRoundIndex = useRef<number>(-1);

    // --- NEW UI STATES ---
    const [evidenceList, setEvidenceList] = useState<{ box: BoxCoordinates; id: string }[]>([]);
    const [isEvidenceMode, setIsEvidenceMode] = useState(false);
    const [introStage, setIntroStage] = useState(0);
    const [secondsElapsed, setSecondsElapsed] = useState(0);
    const [visibleHints, setVisibleHints] = useState<string[]>([]);
    const [hasZoomed, setHasZoomed] = useState(false);

    // Derived Data
    const room = roomState?.room;
    const currentRound = roomState?.currentRound;
    const location = currentRound?.location;

    // Parse Metadata & Hints when location changes
    const hintList = location?.hints ? (typeof location.hints === 'string' ? (location.hints.startsWith('[') ? JSON.parse(location.hints) : location.hints.split('\n')) : location.hints) : [];
    const photographer = location?.image_metadata ? JSON.parse(location.image_metadata).photographer : "";

    // Intro Animation trigger on new round
    useEffect(() => {
        if (location?.id) {
            setIntroStage(0);
            setTimeout(() => setIntroStage(1), 100);
            setTimeout(() => setIntroStage(2), 4000);
            setTimeout(() => setIntroStage(3), 5000);
        }
    }, [location?.id]);

    // 1. Polling & Sync
    useEffect(() => {
        fetcher.load(`/api/room/${code}/status`);
        const interval = setInterval(() => {
            if (fetcher.state === "idle") {
                fetcher.load(`/api/room/${code}/status`);
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [code]);

    useEffect(() => {
        if (fetcher.data) {
            const newData = fetcher.data as any;
            const newIndex = newData.room.current_index;

            // Detect Round Change using Ref to prevent stale closures
            if (lastRoundIndex.current !== -1 && lastRoundIndex.current !== newIndex) {
                setGuess(null);
                setSubmitted(false);
                setResult(null);
                setEvidenceList([]); // Clear evidence
                setVisibleHints([]); // Clear hints
                setHasZoomed(false);

                // Cleanup Marker using Ref
                if (cursorMarkerRef.current) {
                    cursorMarkerRef.current.setMap(null);
                    cursorMarkerRef.current = null;
                }
                setMarker(null);

                if (mapInstance) {
                    mapInstance.setZoom(11);
                    mapInstance.setCenter({ lat: 22.3193, lng: 114.1694 });
                }
            }

            lastRoundIndex.current = newIndex;
            setRoomState(newData);

            // Sync Timer
            if (newData.currentRound?.startTime) {
                const elapsed = Math.floor((Date.now() - newData.currentRound.startTime) / 1000);
                setSecondsElapsed(elapsed);
            }
        }
    }, [fetcher.data]);

    // 2. Map Init
    const mapRef = useRef<HTMLDivElement>(null);
    const cursorMarkerRef = useRef<google.maps.Marker | null>(null); // Ref for reliable cleanup

    useEffect(() => {
        if (room?.status === 'PLAYING' && !mapInstance && mapRef.current) {
            setOptions({ key: mapsApiKey });
            importLibrary("maps").then(async () => {
                const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
                const map = new Map(mapRef.current!, {
                    center: { lat: 22.3193, lng: 114.1694 },
                    zoom: 11,
                    disableDefaultUI: true,
                    mapTypeId: "hybrid",
                    clickableIcons: false, // Prevent POI clicks
                    gestureHandling: "greedy",
                    mapId: "DEMO_MAP_ID",
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (submitted) return;
                    const lat = e.latLng!.lat();
                    const lng = e.latLng!.lng();
                    setGuess({ lat, lng });

                    if (cursorMarkerRef.current) {
                        cursorMarkerRef.current.setPosition({ lat, lng });
                    } else {
                        cursorMarkerRef.current = new google.maps.Marker({
                            position: { lat, lng },
                            map: map,
                        });
                        setMarker(cursorMarkerRef.current); // Keep state for UI triggers if needed, but rely on Ref for logic
                    }
                });

                setMapInstance(map);
            });
        }
    }, [room?.status, mapsApiKey]);

    // Update marker if guess changes (redundant but safe)
    useEffect(() => {
        if (mapInstance && guess) {
            if (!cursorMarkerRef.current) {
                cursorMarkerRef.current = new google.maps.Marker({ position: guess, map: mapInstance });
                setMarker(cursorMarkerRef.current);
            } else {
                cursorMarkerRef.current.setPosition(guess);
            }
        }
    }, [guess, mapInstance]);

    // 3. Hint Logic
    const HINT_INTERVAL = 10;
    const HINT_START_DELAY = 5;
    const timeUntilNext = Math.max(0, HINT_INTERVAL - ((secondsElapsed - HINT_START_DELAY) % HINT_INTERVAL));
    const progress = Math.min(100, Math.max(0, ((HINT_INTERVAL - timeUntilNext) / HINT_INTERVAL) * 100));

    useEffect(() => {
        if (submitted || !location) return;
        if (secondsElapsed >= HINT_START_DELAY) {
            const count = Math.floor((secondsElapsed - HINT_START_DELAY) / HINT_INTERVAL) + 1;
            if (count > 0 && count <= hintList.length) {
                if (visibleHints.length < count) {
                    setVisibleHints(hintList.slice(0, count));
                }
            } else if (count > hintList.length && !hasZoomed && mapInstance) {
                if (secondsElapsed > (HINT_START_DELAY + (hintList.length * HINT_INTERVAL))) {
                    setHasZoomed(true);
                    const offsetLat = (Math.random() - 0.5) * 0.006;
                    const offsetLng = (Math.random() - 0.5) * 0.006;
                    mapInstance.panTo({
                        lat: location.lat + offsetLat, // Adjust for server data shape (lat/lng usually on root of location check schema)
                        lng: location.lng + offsetLng
                    });
                    mapInstance.setZoom(15);
                    setVisibleHints(prev => [...prev, "Satellite Uplink Establishing... Vicinity scan activated."]);
                }
            }
        }
    }, [secondsElapsed, hintList, mapInstance, hasZoomed, submitted]);

    // --- HANDLERS ---
    const handleBoxDrawn = (box: BoxCoordinates | null) => {
        if (box) {
            setEvidenceList(prev => [...prev, { box, id: Math.random().toString(36).substr(2, 9) }]);
        }
    };

    const handleSubmit = () => {
        if (!guess) return;
        setSubmitted(true);
        const formData = new FormData();
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        if (evidenceList.length > 0) {
            formData.append("evidenceList", JSON.stringify(evidenceList));
        }
        actionFetcher.submit(formData, { method: "post", action: `/api/room/${code}/submit` });
    };

    // Watch result
    useEffect(() => {
        if (actionFetcher.data) {
            setResult(actionFetcher.data);
            // Wait for Review mode to draw logic lines
        }
    }, [actionFetcher.data]);


    // --- RENDERS ---
    if (!roomState) return <div className="p-8 text-white text-center">Locating Mission Signal...</div>;

    if (room.status === 'WAITING') {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                <div className="loader mb-8 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <h1 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Stand By</h1>
                <p className="text-slate-400 max-w-xs mx-auto">Waiting for Command...</p>
            </div>
        );
    }

    if (room.status === 'PODIUM') {
        return (
            <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
                <h1 className="text-4xl font-black text-white mb-4">MISSION DEBRIEF</h1>
                <p className="text-slate-400">Check main screen for rankings.</p>
                <a href="/" className="mt-12 px-8 py-3 bg-white/10 rounded-xl text-white font-bold">Leave Session</a>
            </div>
        );
    }

    // PLAYING OR REVIEW (Review keeps map but shows results)
    // Actually Review mode in live might just be waiting?
    // "Teacher will show the image... students will play".
    // If status is REVIEW, we probably show results.

    // Gated Result Mode: Only show Result layout if status is REVIEW
    const layoutMode = room.status === 'REVIEW' ? "result" : "game";

    return (
        <div className="h-[100dvh] w-screen relative overflow-hidden bg-black text-white flex flex-col md:flex-row transition-all duration-700 ease-in-out">

            {/* COLUMN 1: EVIDENCE / IMAGE */}
            <div className={`relative h-full transition-all duration-700 ease-in-out border-r border-white/10 overflow-hidden
                ${layoutMode === "result" ? "w-full md:w-[40%]" : "w-full md:w-1/2"}`}
            >
                {/* Intro Splash */}
                {introStage < 3 && location && (
                    <div className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-black/60 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="text-center">
                            <div className="mb-2 text-[10px] font-mono text-blue-300 tracking-widest uppercase">Incoming Transmission</div>
                            <h1 className="text-6xl font-black text-white tracking-tighter mb-2">SECTOR {location.id?.slice(-4).toUpperCase()}</h1>
                            <div className="text-4xl font-black text-yellow-400">{"★".repeat(Math.ceil((location.difficulty_rating || 1) / 2))}</div>
                        </div>
                    </div>
                )}

                {/* Hints Overlay */}
                {!submitted && visibleHints.length > 0 && (
                    <div className="absolute bottom-24 left-6 z-30 max-w-sm space-y-2 pointer-events-none">
                        {visibleHints.map((hint, i) => (
                            <div key={i} className="bg-black/40 backdrop-blur-xl border-l-4 border-yellow-400 p-3 rounded text-xs text-white animate-in slide-in-from-left-10">
                                {hint}
                            </div>
                        ))}
                    </div>
                )}

                {/* Mode Toggle */}
                {!submitted && (
                    <div className="absolute top-6 right-6 z-30 flex flex-col items-end gap-2 pointer-events-auto">
                        <button onClick={() => setIsEvidenceMode(!isEvidenceMode)} className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all shadow-xl backdrop-blur-md ${isEvidenceMode ? 'bg-green-500/20 text-green-400 border-green-500' : 'bg-white/10 text-white'}`}>
                            {isEvidenceMode ? "Scanner Active" : "Enable Scanner"}
                        </button>
                    </div>
                )}

                {/* Canvas */}
                <div className={`w-full h-full relative ${isEvidenceMode ? 'cursor-crosshair' : ''}`}>
                    {location?.image_url ? (
                        <EvidenceCanvas
                            imageUrl={location.image_url}
                            onBoxChange={isEvidenceMode ? handleBoxDrawn : () => { }}
                            disabled={submitted || !isEvidenceMode}
                        >
                            {/* User Evidence (Green) */}
                            {evidenceList.map((ev) => (
                                <div key={ev.id} className="absolute border-2 border-green-400 bg-green-400/10"
                                    style={{ left: `${ev.box.x / 10}%`, top: `${ev.box.y / 10}%`, width: `${ev.box.w / 10}%`, height: `${ev.box.h / 10}%` }}
                                >
                                    {!submitted && (
                                        <button onClick={(e) => { e.stopPropagation(); setEvidenceList(prev => prev.filter(i => i.id !== ev.id)); }} className="bg-red-500 text-white w-5 h-5 flex items-center justify-center text-xs absolute -top-2 -right-2 rounded-full">✕</button>
                                    )}
                                </div>
                            ))}

                            {/* Official Evidence (Yellow) - Only in Review */}
                            {room.status === 'REVIEW' && currentRound?.evidence?.map((ev: any) => {
                                let box;
                                try { box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box; } catch (e) { return null; }
                                if (!box) return null;
                                return (
                                    <div key={ev.id} className="absolute border-2 border-yellow-400 bg-yellow-400/10 flex flex-col items-start p-1"
                                        style={{ left: `${box.x / 10}%`, top: `${box.y / 10}%`, width: `${box.w / 10}%`, height: `${box.h / 10}%` }}
                                    >
                                        <div className="bg-yellow-500 text-black text-[9px] font-bold px-1 rounded-sm shadow opacity-0 group-hover:opacity-100 transition-opacity">
                                            {ev.description}
                                        </div>
                                    </div>
                                );
                            })}
                        </EvidenceCanvas>
                    ) : <div className="flex items-center justify-center h-full">No Signal</div>}
                </div>
            </div>

            {/* COLUMN 2: MAP */}
            <div className={`transition-all duration-700 ease-in-out bg-slate-900 overflow-hidden relative border-r border-white/10
                 ${layoutMode === "result" ? "relative w-full md:w-[40%] h-full" : "relative w-full md:w-1/2 h-full"}`}
            >
                <div ref={mapRef} className="w-full h-full" />

                {!submitted ? (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xs px-4">
                        <button onClick={handleSubmit} disabled={!guess} className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all border border-white/10 backdrop-blur-xl ${guess ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-black/40 text-white/20'}`}>
                            CONFIRM COORDINATES
                        </button>
                    </div>
                ) : (
                    <div className="absolute bottom-6 left-6 right-6 z-10">
                        <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5">
                            <div className="text-xs uppercase tracking-widest mb-1 text-emerald-300">Target Acquired</div>
                            <div className="text-lg font-black">LOCKED IN</div>
                            <div className="text-[10px] font-mono opacity-70 mt-1 uppercase">Awaiting Mission Control Reveal...</div>
                        </div>
                    </div>
                )}
            </div>

            {/* COLUMN 3: RESULTS */}
            <div className={`transition-all duration-700 ease-in-out bg-slate-950 flex flex-col h-full overflow-hidden ${layoutMode === "result" ? "w-full md:w-[20%] opacity-100" : "w-0 opacity-0"}`}>
                {result ? (
                    <div className="p-6">
                        <h2 className="text-5xl font-black text-white">{result.score || 0}</h2>
                        <p className="text-xs text-green-400 uppercase">Score</p>
                        <hr className="border-white/10 my-4" />

                        <div className="text-xl font-bold">
                            {result.distance !== undefined && !isNaN(result.distance)
                                ? `${Math.round(result.distance)}m`
                                : "-- m"}
                        </div>
                        <p className="text-xs text-slate-500 uppercase">Deviation</p>

                        <div className="mt-8 space-y-4">
                            <h3 className="text-xs uppercase text-slate-400 mb-2">Analysis</h3>
                            {result.fullFeedback && result.fullFeedback.results && result.fullFeedback.results.length > 0 ? (
                                result.fullFeedback.results.map((item: any, i: number) => (
                                    <div key={i} className="text-xs text-slate-300 border-l-2 border-blue-500/50 pl-3 py-1">
                                        <div className="flex justify-between">
                                            <span className="font-bold text-blue-400 block mb-1">Found: {item.description}</span>
                                        </div>
                                        <p className="opacity-80 leading-snug">{item.explanation}</p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-500 italic">Target data processing...</p>
                            )}

                            {/* Matched Evidence Summary */}
                            {result.evidenceScore > 0 && (
                                <div className="mt-2 py-2 px-3 bg-green-500/20 rounded border border-green-500/30 flex justify-between">
                                    <span className="text-green-400 text-xs font-bold">Intel Bonus</span>
                                    <span className="text-white text-xs font-bold">+{result.evidenceScore}</span>
                                </div>
                            )}
                        </div>

                        <div className="mt-8">
                            <h3 className="text-xs uppercase text-slate-400 mb-2">Waiting for next round...</h3>
                        </div>
                    </div>
                ) : (
                    <div className="p-6 text-center text-slate-500 italic">Processing Telemetry...</div>
                )}
            </div>
        </div>
    );
}
