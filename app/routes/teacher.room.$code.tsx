import { Form, useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireTeacher } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";
// import { GoogleMap, Marker } from "@react-google-maps/api"; // Will need to adapt for Remix/Vite or use existing loader

export async function loader({ request, params, context }: any) {
    const userId = await requireTeacher(request);
    const code = params.code;
    const env = context.cloudflare.env as any;

    // Initial fetch to ensure validity
    const db = env.DB as D1Database;
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();

    if (!room) {
        throw new Response("Room Not Found", { status: 404 });
    }

    return {
        code,
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        initialStatus: room.status
    };
}

export default function TeacherRoom() {
    const { code, mapsApiKey } = useLoaderData() as any;
    const fetcher = useFetcher();
    const actionFetcher = useFetcher(); // For buttons (Start, Skip, Next)

    // Local State derived from poller
    const [roomState, setRoomState] = useState<any>(null);
    const [timeLeft, setTimeLeft] = useState(300); // 5 mins default

    // --- ANIMATION STATE ---
    const [introStage, setIntroStage] = useState(0);

    useEffect(() => {
        if (roomState?.currentRound?.location?.id) {
            setIntroStage(0);
            setTimeout(() => setIntroStage(1), 100);
            setTimeout(() => setIntroStage(2), 4000);
            setTimeout(() => setIntroStage(3), 5000);
        }
    }, [roomState?.currentRound?.location?.id]);

    // --- REVIEW MAP LOGIC ---
    const mapRef = useRef<HTMLDivElement>(null);
    const [reviewMap, setReviewMap] = useState<google.maps.Map | null>(null);
    const markersRef = useRef<google.maps.Marker[]>([]);
    const hasAutoSkipped = useRef(false);

    useEffect(() => {
        const room = roomState?.room;
        const currentRound = roomState?.currentRound;
        const status = room?.status;

        if (status === 'REVIEW' && !reviewMap && mapRef.current) {
            setOptions({
                key: mapsApiKey,

            });

            importLibrary("maps").then(async () => {
                const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
                const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

                const center = currentRound?.location ?
                    { lat: currentRound.location.lat, lng: currentRound.location.lng } :
                    { lat: 22.3193, lng: 114.1694 };

                const map = new Map(mapRef.current!, {
                    center,
                    zoom: 14,
                    disableDefaultUI: true,
                    mapId: "TEACHER_REVIEW_MAP",
                });

                setReviewMap(map);

                // Official Target
                if (currentRound?.location) {
                    const pin = new PinElement({
                        background: "#EF4444",
                        borderColor: "#7F1D1D",
                        glyphColor: "white",
                        scale: 1.2
                    });

                    new AdvancedMarkerElement({
                        position: { lat: currentRound.location.lat, lng: currentRound.location.lng },
                        map,
                        title: "Official Target",
                        content: pin.element
                    });
                }

                // Fetch guesses
                fetch(`/api/room/${code}/review?round=${room.current_index}`).then(res => res.json()).then((data: any) => {
                    console.log("Teacher Review Data:", data);
                    if (data.guesses) {
                        const bounds = new google.maps.LatLngBounds();
                        if (currentRound?.location) {
                            bounds.extend({ lat: currentRound.location.lat, lng: currentRound.location.lng });
                        }

                        data.guesses.forEach((g: any) => {
                            // Student Profile Marker
                            const div = document.createElement("div");
                            div.className = "custom-marker-profile";
                            div.style.cssText = "width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.5); overflow: hidden; background: #3b82f6; position: relative; transition: transform 0.2s;";

                            // Avatar or Initials
                            if (g.profile_picture_url) {
                                const img = document.createElement("img");
                                img.src = g.profile_picture_url;
                                img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
                                div.appendChild(img);
                            } else {
                                div.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:16px;">${g.display_name ? g.display_name[0].toUpperCase() : "?"}</div>`;
                            }

                            // Tooltip (Name + Distance) on hover? 
                            // Default 'title' works for simple tooltip. 
                            // AdvancedMarker can handle click events too.

                            const m = new AdvancedMarkerElement({
                                position: { lat: g.lat, lng: g.lng },
                                map,
                                content: div,
                                title: `${g.display_name} (${Math.round(g.distance * 1000)}m)`,
                                zIndex: 100
                            });

                            // markersRef.current.push(m); // AdvancedMarkerElement is not same type as Marker. 
                            // We can just keep it in loop or store if needed for cleanup.

                            bounds.extend({ lat: g.lat, lng: g.lng });
                        });

                        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
                    }
                });
            });
        }

        if (status !== 'REVIEW' && reviewMap) {
            setReviewMap(null);
            markersRef.current = [];
        }
    }, [roomState, mapsApiKey]);

    // Trigger animation on mount if in playing state
    // Trigger animation on mount or when data first arrives if in playing state
    useEffect(() => {
        if (roomState?.room?.status === 'PLAYING') {
            // Only trigger if we haven't shown it yet or if it's a fresh load (introStage is default 3? No, default 0?)
            // Actually, we want it to run once per round.
            // The polling effect handles round changes.
            // This effect handles the INITIAL load if the user refreshes mid-game.
            setIntroStage(0);
            setTimeout(() => setIntroStage(1), 500);
            setTimeout(() => setIntroStage(2), 3500);
            setTimeout(() => setIntroStage(3), 4500);
        }
    }, []); // Run ONCE on mount using the initial loader data (if any)
    // Wait, roomState comes from loader?? 
    // If roomState is from useState(loaderData), it's set initially.
    // Let's verify initial state.


    // Polling Logic
    useEffect(() => {
        // Initial load
        fetcher.load(`/api/room/${code}/status`);

        const interval = setInterval(() => {
            if (fetcher.state === "idle") {
                fetcher.load(`/api/room/${code}/status`);
            }
        }, 1000); // Poll faster (1s) to catch state changes, though timer handles local tick
        return () => clearInterval(interval);
    }, [code]);

    // Update local state when fetcher returns data
    useEffect(() => {
        if (fetcher.data) {
            const data = fetcher.data as any;

            // Detect Round Change for Animation
            if (data.currentRound?.index !== roomState?.currentRound?.index) {
                setIntroStage(0);
                setTimeout(() => setIntroStage(1), 1000);
                setTimeout(() => setIntroStage(2), 4000);
                setTimeout(() => setIntroStage(3), 5000); // End intro
                hasAutoSkipped.current = false; // Reset auto-skip
            }

            setRoomState(data);
            // ... rest of logic

            // Sync Timer if playing
            if (data.room?.status === 'PLAYING' && data.currentRound) {
                const elapsedSec = Math.floor((Date.now() - data.currentRound.startTime) / 1000);
                const limit = data.currentRound.timeLimit || 120; // Default 120s
                const remaining = Math.max(0, limit - elapsedSec);
                setTimeLeft(remaining);

                if (remaining === 0 && !hasAutoSkipped.current && actionFetcher.state === "idle") {
                    hasAutoSkipped.current = true;
                    actionFetcher.submit({ action: "SKIP_TIMER" }, { method: "post", action: `/api/room/${code}/action` });
                }
            }
        }
    }, [fetcher.data]);

    if (!roomState) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Connecting to HQ...</div>;

    const { room, participants, currentRound } = roomState;
    if (!room) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Connecting to HQ...</div>;

    // --- RENDERERS ---

    // --- RENDERERS ---

    const renderLobby = () => (
        <div className="flex flex-col items-center justify-center h-full space-y-12 animate-in fade-in">
            <div className="text-center space-y-4">
                <p className="text-2xl uppercase font-bold text-blue-400 tracking-widest">Join at hkgeohunter.com/join</p>
                <h1 className="text-9xl font-black text-white tracking-tighter bg-white/10 px-12 py-6 rounded-3xl border-4 border-dashed border-white/20">
                    {code}
                </h1>
            </div>

            <div className="fixed top-6 right-6 z-50">
                <Link to={`/teacher/control/${code}`} target="_blank" rel="noreferrer" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold text-[10px] uppercase tracking-widest border border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.5)] transition-all flex items-center gap-2 hover:scale-105">
                    <span>📱</span> Launch Control Pad
                </Link>
            </div>

            <div className="w-full max-w-5xl">
                <h2 className="text-xl text-center uppercase font-bold text-slate-500 mb-6 tracking-widest">
                    {participants.length} Agents Ready
                </h2>
                <div className="flex flex-wrap justify-center gap-4">
                    {participants.map((p: any) => (
                        <div key={p.display_name} className="px-6 py-3 bg-white/10 rounded-full border border-white/10 text-xl font-bold text-white animate-in zoom-in-50">
                            {p.display_name}
                        </div>
                    ))}
                </div>
            </div>

            {/* Settings Config */}
            <div className="bg-slate-900 border border-white/10 p-6 rounded-xl flex gap-8 items-center">
                <div className="flex flex-col">
                    <label className="text-xs uppercase font-bold text-slate-400 mb-2">Hint Frequency</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            defaultValue={room.hint_interval || 30}
                            min="5" max="120"
                            className="bg-black/50 border border-white/20 rounded px-3 py-2 text-white font-mono w-20 text-center"
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (val > 0) {
                                    const fd = new FormData();
                                    fd.append("action", "UPDATE_SETTINGS");
                                    fd.append("hintInterval", val.toString());
                                    actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                                }
                            }}
                        />
                        <span className="text-sm text-slate-400">seconds</span>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-12 inset-x-0 flex justify-center">
                <button
                    onClick={() => actionFetcher.submit({ action: "START_GAME" }, { method: "post", action: `/api/room/${code}/action` })}
                    className="px-16 py-6 bg-blue-600 hover:bg-blue-500 text-white text-3xl font-black uppercase tracking-widest rounded-full shadow-2xl hover:scale-105 transition-all"
                >
                    Start Mission
                </button>
            </div>
        </div>
    );



    const renderPlaying = () => {
        // Calculate Hint Status
        const HINT_INTERVAL = room?.hint_interval || 30;
        // How long has round been running?
        const secondsElapsed = currentRound.startTime ? Math.floor((Date.now() - currentRound.startTime) / 1000) : 0;
        const timeUntilNextHint = Math.max(0, HINT_INTERVAL - (secondsElapsed % HINT_INTERVAL));
        // Next hint index (1-based for display "Hint 1 incoming")
        const nextHintIndex = Math.floor(secondsElapsed / HINT_INTERVAL) + 1;

        return (
            <div className="h-full flex flex-col relative">
                {/* Header / Timer */}
                <div className="absolute top-0 inset-x-0 z-50 p-6 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-xl border border-white/10 flex flex-col items-center pointer-events-auto">
                        <span className="text-xs text-slate-400 uppercase tracking-widest mb-1">Mission Progress</span>
                        <span className="text-lg font-mono font-bold text-blue-300">ROUND {currentRound.index + 1}/{currentRound.total}</span>
                    </div>

                    <div className="flex flex-col items-center pointer-events-auto">
                        <div className={`text-6xl font-black font-mono tracking-tighter drop-shadow-lg ${timeLeft < 30 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                            {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                        </div>

                        {/* Hint Timer Display for Teacher */}
                        {(() => {
                            const hints = currentRound?.location?.hints ? (typeof currentRound.location.hints === 'string' ? (currentRound.location.hints.startsWith('[') ? JSON.parse(currentRound.location.hints) : currentRound.location.hints.split('\n')) : currentRound.location.hints) : [];
                            if (nextHintIndex <= hints.length) {
                                return (
                                    <div className="mt-2 flex items-center gap-2 bg-black/40 backdrop-blur rounded-full px-4 py-1 border border-white/10">
                                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                        <span className="text-xs text-yellow-100 font-mono uppercase">
                                            Hint {Math.max(1, nextHintIndex)} incoming in {timeUntilNextHint}s
                                        </span>
                                    </div>
                                );
                            }
                            return null;
                        })()}
                    </div>

                    <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-xl border border-white/10 flex flex-col items-center">
                        <span className="text-xs text-slate-400 uppercase tracking-widest mb-1">Active Agents</span>
                        <span className="text-lg font-mono font-bold text-green-300">{participants.length} Online</span>
                    </div>
                </div>

                {/* Intro Splash */}
                {introStage < 3 && currentRound?.location && (
                    <div className={`absolute inset-0 z-[60] flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-black/60 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="text-center">
                            <div className="mb-2 text-[10px] font-mono text-blue-300 tracking-widest uppercase">Incoming Transmission</div>
                            <h1 className="text-6xl font-black text-white tracking-tighter mb-2">SECTOR {currentRound.location.id?.slice(-4).toUpperCase()}</h1>
                            <div className="text-4xl font-black text-yellow-400">{"★".repeat(Math.ceil((currentRound.location.difficulty_rating || 1) / 2))}</div>
                        </div>
                    </div>
                )}

                {/* Full screen Image */}
                {currentRound?.location?.image_url && (
                    <div className="absolute inset-0 z-0 flex items-center justify-center bg-black">
                        <img
                            src={currentRound.location.image_url}
                            className="w-full h-full object-contain"
                            alt="Location"
                        />
                    </div>
                )}

                {/* Teacher Control */}
                <div className="absolute bottom-12 right-12 z-50 flex flex-col items-end gap-4 pointer-events-auto">
                    <Link to={`/teacher/control/${code}`} target="_blank" rel="noreferrer" className="px-4 py-2 bg-blue-600/90 backdrop-blur hover:bg-blue-500 text-white rounded-full font-bold text-[10px] uppercase tracking-widest border border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.5)] transition-all flex items-center gap-2 hover:scale-105">
                        <span>📱</span> Control Pad
                    </Link>

                    <button
                        onClick={() => actionFetcher.submit({ action: "SKIP_TIMER" }, { method: "post", action: `/api/room/${code}/action` })}
                        className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/20 rounded-2xl text-white font-bold uppercase tracking-widest hover:scale-105 transition-all flex flex-col items-center shadow-2xl"
                    >
                        <span>Reveal Intel →</span>
                        <span className="text-[10px] text-blue-300 mt-1">
                            {roomState.currentRound?.submissionCount || 0} / {participants.length} Reported
                        </span>
                    </button>
                </div>
            </div>
        );
    }

    // --- REVIEW MAP LOGIC MOVED TO TOP ---

    const renderReview = () => {
        // Prepare Official Evidence for Canvas
        const officialEvidence = currentRound?.evidence?.map((ev: any) => {
            try {
                const box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box;
                return { ...ev, box };
            } catch (e) { return null; }
        }).filter(Boolean);

        return (
            <div className="h-full flex overflow-hidden">
                {/* COLUMN 1: IMAGE & EVIDENCE (35%) */}
                <div className="w-[35%] bg-black relative border-r border-white/10 flex flex-col">
                    <div className="absolute top-0 left-0 p-4 z-10 bg-gradient-to-b from-black/80 to-transparent w-full">
                        <h2 className="text-xl font-black text-white uppercase tracking-tighter">
                            Sector {currentRound?.location?.id?.slice(-4).toUpperCase()}
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded shadow-lg uppercase tracking-wider">
                                Official Intel
                            </div>
                            <div className="text-xs text-slate-400">
                                {officialEvidence?.length || 0} Items
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 relative cursor-default">
                        {currentRound?.location?.image_url ? (
                            <EvidenceCanvas
                                imageUrl={currentRound.location.image_url}
                                onBoxChange={() => { }}
                                disabled={true}
                            >
                                {/* Overlay Official Boxes */}
                                {officialEvidence?.map((ev: any) => (
                                    <button
                                        key={ev.id}
                                        onClick={() => actionFetcher.submit(
                                            { action: "FOCUS_EVIDENCE", evidenceId: ev.id },
                                            { method: "post", action: `/api/room/${code}/action` }
                                        )}
                                        className="absolute border-2 border-yellow-400 bg-yellow-400/10 flex flex-col items-start p-1 transition-all hover:bg-yellow-400/30 hover:scale-105 active:scale-95 cursor-pointer group"
                                        style={{
                                            left: `${ev.box.x / 10}%`,
                                            top: `${ev.box.y / 10}%`,
                                            width: `${ev.box.w / 10}%`,
                                            height: `${ev.box.h / 10}%`
                                        }}
                                    >
                                        {/* Tooltip on Hover */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[9999] bg-slate-900/90 backdrop-blur-md border border-yellow-500 text-white text-[10px] font-bold px-3 py-2 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-wrap min-w-[200px] pointer-events-none">
                                            {ev.ai_analysis ? (
                                                <>
                                                    <span className="text-yellow-400 font-black block mb-1 uppercase tracking-wider text-[9px]">🤖 AI Analysis</span>
                                                    <span className="text-slate-200 font-medium leading-relaxed">{ev.ai_analysis}</span>
                                                </>
                                            ) : ev.description}
                                        </div>

                                        {/* Click Hint */}
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            <span className="bg-black/50 text-white text-[8px] uppercase font-bold px-1 rounded backdrop-blur">
                                                Tap to Reveal
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </EvidenceCanvas>
                        ) : <div className="flex items-center justify-center h-full text-slate-500">No Image Data</div>}
                    </div>
                </div>

                {/* COLUMN 2: MAP (40%) */}
                <div className="w-[40%] relative bg-slate-800 border-r border-white/10">
                    <div ref={mapRef} className="absolute inset-0 w-full h-full" />
                    <div className="absolute bottom-4 left-4 z-10 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs text-white border border-white/10">
                        Map Data: Hybrid/Labels
                    </div>
                </div>

                {/* COLUMN 3: LEADERBOARD/CONTROLS (25%) */}
                <div className="w-[25%] bg-slate-900/95 backdrop-blur-xl flex flex-col z-10 relative shadow-2xl">
                    <div className="p-6 border-b border-white/10">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Round Analysis</h3>
                        <div className="flex justify-between items-end">
                            <div>
                                <span className="block text-3xl font-black text-white">{participants.length}</span>
                                <span className="text-[10px] text-slate-400 uppercase">Agents Deployed</span>
                            </div>
                            <div className="text-right">
                                <span className="block text-3xl font-black text-green-400">
                                    {officialEvidence?.length || 0}
                                </span>
                                <span className="text-[10px] text-slate-400 uppercase">Intel Items</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">
                            Deployment Log
                        </h3>
                        {participants.map((p: any, i: number) => (
                            <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-white/5 border-white/5'} hover:bg-white/10 transition-colors cursor-pointer`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-white'}`}>
                                        {i + 1}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-lg text-white truncate max-w-[200px]">{p.display_name}</span>
                                        {i === 0 && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">Current Leader</span>}
                                    </div>
                                </div>
                                <span className="font-mono text-2xl text-blue-300 font-black">{p.score}</span>
                            </div>
                        ))}
                    </div>

                    {/* Official Evidence List Toggle/View */}
                    {officialEvidence?.length > 0 && (
                        <div className="p-4 border-t border-white/10 bg-slate-900/50">
                            <h4 className="text-[10px] uppercase font-bold text-yellow-500 tracking-wider mb-2">Official Intel</h4>
                            <div className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar">
                                {officialEvidence.map((ev: any) => (
                                    <div key={ev.id} className="text-[10px] text-slate-400 border-l-2 border-yellow-500/20 pl-2 hover:border-yellow-500 hover:text-white transition-colors cursor-help group relative">
                                        <span className="block truncate">{ev.description}</span>
                                        {/* Optional tooltip for full text if truncated */}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="p-6 border-t border-white/10 bg-slate-900">
                        <button
                            onClick={() => actionFetcher.submit({ action: "NEXT_ROUND" }, { method: "post", action: `/api/room/${code}/action` })}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-black uppercase tracking-widest rounded-xl shadow-lg transition-all transform hover:scale-[1.02]"
                        >
                            Next Location →
                        </button>
                    </div>
                </div>

                {/* Teacher Evidence Reveal Modal (Syncs with Students) */}
                {roomState.currentRound?.focusedEvidenceId && (
                    (() => {
                        const focusedItem = officialEvidence.find((e: any) => e.id === roomState.currentRound.focusedEvidenceId);
                        if (!focusedItem) return null;

                        return (
                            <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
                                <div className="bg-slate-900 border-2 border-yellow-500 rounded-2xl max-w-2xl w-full p-8 shadow-2xl relative animate-in zoom-in-95 duration-300 flex flex-col gap-6">

                                    <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                            <div className="text-yellow-400 text-xs font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                                                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                                Broadcasting Intel
                                            </div>
                                            <h2 className="text-3xl font-black text-white mb-4 uppercase tracking-tighter">
                                                {focusedItem.description}
                                            </h2>
                                            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                                <h3 className="text-blue-300 text-[10px] font-bold uppercase tracking-widest mb-2">AI Analysis</h3>
                                                <p className="text-slate-300 text-sm leading-relaxed">
                                                    {focusedItem.ai_analysis || "No analysis data."}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-4 pt-4 border-t border-white/10">
                                        <button
                                            onClick={() => actionFetcher.submit({ action: "CLEAR_FOCUS" }, { method: "post", action: `/api/room/${code}/action` })}
                                            className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest rounded-lg shadow-lg hover:scale-105 transition-all"
                                        >
                                            Dismiss for Class
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()
                )}
            </div>
        );
    };

    const renderPodium = () => (
        <div className="h-full flex flex-col items-center justify-center space-y-12 animate-in fade-in">
            <h1 className="text-8xl font-black text-yellow-400 tracking-tighter drop-shadow-2xl">MISSION ACCOMPLISHED</h1>

            <div className="flex items-end gap-8">
                {/* 2nd Place */}
                {participants[1] && (
                    <div className="flex flex-col items-center">
                        <div className="w-32 h-32 rounded-full bg-slate-300 border-4 border-white mb-4 flex items-center justify-center text-4xl font-black text-slate-800">
                            {participants[1].display_name[0]}
                        </div>
                        <div className="h-48 w-40 bg-slate-700 rounded-t-2xl flex items-end justify-center pb-4">
                            <span className="text-4xl font-black text-white">#2</span>
                        </div>
                        <div className="mt-4 text-center">
                            <h3 className="text-2xl font-bold text-white">{participants[1].display_name}</h3>
                            <p className="text-xl text-slate-400">{participants[1].score} pts</p>
                        </div>
                    </div>
                )}

                {/* 1st Place */}
                {participants[0] && (
                    <div className="flex flex-col items-center">
                        <div className="text-6xl mb-6">👑</div>
                        <div className="w-40 h-40 rounded-full bg-yellow-400 border-4 border-white mb-4 flex items-center justify-center text-5xl font-black text-yellow-900 shadow-[0_0_50px_rgba(250,204,21,0.5)]">
                            {participants[0].display_name[0]}
                        </div>
                        <div className="h-64 w-48 bg-yellow-600 rounded-t-2xl flex items-end justify-center pb-4 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                            <span className="text-6xl font-black text-white relative z-10">#1</span>
                        </div>
                        <div className="mt-4 text-center">
                            <h3 className="text-3xl font-black text-white">{participants[0].display_name}</h3>
                            <p className="text-2xl text-yellow-400 font-bold">{participants[0].score} pts</p>
                        </div>
                    </div>
                )}

                {/* 3rd Place */}
                {participants[2] && (
                    <div className="flex flex-col items-center">
                        <div className="w-28 h-28 rounded-full bg-orange-400 border-4 border-white mb-4 flex items-center justify-center text-3xl font-black text-orange-900">
                            {participants[2].display_name[0]}
                        </div>
                        <div className="h-40 w-40 bg-orange-700 rounded-t-2xl flex items-end justify-center pb-4">
                            <span className="text-4xl font-black text-white">#3</span>
                        </div>
                        <div className="mt-4 text-center">
                            <h3 className="text-xl font-bold text-white">{participants[2].display_name}</h3>
                            <p className="text-lg text-slate-400">{participants[2].score} pts</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-12">
                <Link to="/teacher/dashboard" className="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold uppercase tracking-widest">
                    Return to Base
                </Link>
            </div>
        </div>
    );

    return (
        <div className="w-screen h-screen bg-slate-950 overflow-hidden font-sans select-none">
            {room.status === 'WAITING' && renderLobby()}
            {room.status === 'PLAYING' && renderPlaying()}
            {room.status === 'REVIEW' && renderReview()}
            {room.status === 'PODIUM' && renderPodium()}
        </div>
    );
}
