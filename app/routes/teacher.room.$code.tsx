import { Form, useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { requireTeacher } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";
import { motion, animate, useMotionValue, useTransform } from "framer-motion";
import { LiveLeaderboard } from "~/components/teacher/LiveLeaderboard";
// import { GoogleMap, Marker } from "@react-google-maps/api"; // Will need to adapt for Remix/Vite or use existing loader

export async function loader({ request, params, context }: any) {
    const userId = await requireTeacher(request);
    const code = params.code;
    const env = context.cloudflare.env as any;

    const db = env.DB as D1Database;
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();

    if (!room) {
        throw new Response("Room Not Found", { status: 404 });
    }

    // Build full initial room state (mirrors api.room.$code.status logic)
    const [participantsResult, mapSetInfo] = await Promise.all([
        db.prepare(`
            SELECT rp.*, u.display_name, u.profile_picture_url 
            FROM room_participants rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_code = ? 
            ORDER BY rp.score DESC
        `).bind(code).all<any>(),
        room.map_set_id ? Promise.all([
            db.prepare("SELECT COUNT(*) as count FROM map_set_items WHERE set_id = ?").bind(room.map_set_id).first<any>(),
            db.prepare(
                "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
            ).bind(room.map_set_id, room.current_index).first<any>()
        ]) : Promise.resolve([null, null])
    ]);

    const participants = participantsResult.results || [];
    const [total, item] = mapSetInfo;
    let currentRound = null;

    const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;

    if (isGuidedRound) {
        // Tutorial round — use default simulation location
        let defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
        if (!defaultSim) {
            defaultSim = await db.prepare("SELECT id FROM locations ORDER BY created_at ASC LIMIT 1").first<any>();
        }
        if (defaultSim) {
            const totalResult = total || { count: 0 };
            const [location, allEvidence] = await Promise.all([
                db.prepare("SELECT * FROM locations WHERE id = ?").bind(defaultSim.id).first<any>(),
                db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(defaultSim.id).all<any>()
            ]);
            let evidence: any[] = [];
            if (room.status === 'REVIEW') evidence = allEvidence.results || [];
            const evidenceCount = allEvidence.results?.length || 0;
            currentRound = {
                index: room.current_index,
                total: (totalResult.count || 0) + 1,
                startTime: room.round_start_time,
                location, evidence, evidenceCount,
                focusedEvidenceId: room.focused_evidence_id,
                submissionCount: 0,
                timeLimit: room.time_limit || 120,
                isGuidedRound: true,
                isRewardRound: (location?.difficulty_rating || 0) >= 8
            };
        }
    } else if (item) {
        const datasetIndex = room.has_guided_playthrough ? room.current_index - 1 : room.current_index;
        const realItem = room.has_guided_playthrough
            ? await db.prepare("SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?").bind(room.map_set_id, datasetIndex).first<any>()
            : item;
        if (realItem) {
            const targetLocationId = realItem.location_id;
            const [location, allEvidence, submissionCountResult] = await Promise.all([
                db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>(),
                db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(targetLocationId).all<any>(),
                db.prepare("SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?").bind(code, targetLocationId).first<any>()
            ]);
            let evidence: any[] = [];
            if (room.status === 'REVIEW') evidence = allEvidence.results || [];
            const evidenceCount = allEvidence.results?.length || 0;
            const totalRounds = room.has_guided_playthrough ? (total?.count || 0) + 1 : (total?.count || 0);
            currentRound = {
                index: room.current_index,
                total: totalRounds,
                startTime: room.round_start_time,
                location, evidence, evidenceCount,
                focusedEvidenceId: room.focused_evidence_id,
                submissionCount: submissionCountResult?.count || 0,
                timeLimit: room.time_limit || 120,
                isGuidedRound: false,
                isRewardRound: (location?.difficulty_rating || 0) >= 8
            };
        }
    }

    const initialRoomState = { room, participants, currentRound };

    return {
        code,
        mapsApiKey: env.GOOGLE_MAPS_API_KEY,
        initialRoomState
    };
}

function TeacherHighPrecisionHUD({ currentRound, room, serverClockOffsetRef }: any) {
    const timeLimit = currentRound?.timeLimit || 120;
    const taMax = room?.ta_max_multiplier ?? 2.0;
    const taMin = room?.ta_min_multiplier ?? 0.5;
    const graceSec = room?.ta_grace_period ?? 30;

    const START_GRACE = Math.min(graceSec, Math.floor(timeLimit * 0.25));
    const END_GRACE = Math.min(graceSec, Math.floor(timeLimit * 0.25));
    const DECAY_WINDOW = Math.max(1, timeLimit - START_GRACE - END_GRACE);

    const [displayMultiplier, setDisplayMultiplier] = useState(taMax);
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        let animationFrameId: number;

        const updateMultiplier = () => {
            if (!currentRound?.startTime) return;
            const currentSeconds = Math.max(0, (Date.now() - serverClockOffsetRef.current - currentRound.startTime) / 1000);
            
            let active = taMax;
            if (currentSeconds > START_GRACE) {
                if (currentSeconds >= timeLimit - END_GRACE) active = taMin;
                else active = taMax - ((taMax - taMin) * ((currentSeconds - START_GRACE) / DECAY_WINDOW));
            }
            
            setDisplayMultiplier(active);
            setProgress(Math.max(0, ((active - taMin) / (taMax - taMin)) * 100));

            animationFrameId = requestAnimationFrame(updateMultiplier);
        };

        animationFrameId = requestAnimationFrame(updateMultiplier);
        return () => cancelAnimationFrame(animationFrameId);
    }, [serverClockOffsetRef, currentRound?.startTime, timeLimit, taMax, taMin, START_GRACE, END_GRACE, DECAY_WINDOW]);

    return (
        <div className="flex flex-col items-center pointer-events-none z-20 w-full mb-3 mt-1">
            <span className="text-[10px] font-black uppercase text-blue-200 tracking-[0.2em] bg-blue-900/60 px-3 py-1 rounded-t-lg backdrop-blur-md border-x border-t border-blue-500/30">
                Score Multiplier
            </span>
            {/* Liquid Glass Dynamic Bar */}
            <div className={`w-full max-w-xs bg-slate-900/80 backdrop-blur-xl rounded-b-xl rounded-t-none border border-blue-500/30 h-7 relative overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.8)]`}>
                
                {/* Retracting Fluid Core */}
                <div 
                    className="absolute top-0 left-0 h-full flex items-center pr-3 overflow-hidden shadow-[inset_0_-2px_8px_rgba(0,0,0,0.6)]"
                    style={{
                        width: `${progress}%`,
                        background: `linear-gradient(90deg, #1e3a8a 0%, #3b82f6 100%)`,
                        boxShadow: `0 0 15px #3b82f6`
                    }}
                >
                    <div className="ml-auto w-1 h-3/4 rounded-full bg-white/80 animate-pulse shadow-[0_0_5px_white]" />
                </div>

                {/* Normal High-Precision Text Overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 font-mono tracking-widest text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
                    <div className="text-sm font-black uppercase text-shadow">
                        GLOBAL: {displayMultiplier.toFixed(4)}x
                    </div>
                </div>
            </div>
            
            <div className="mt-1 flex justify-between w-full max-w-xs px-2 font-mono">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Min: {taMin.toFixed(1)}x</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Max: {taMax.toFixed(1)}x</span>
            </div>
        </div>
    );
}

export default function TeacherRoom() {
    const { code, mapsApiKey, initialRoomState } = useLoaderData() as any;
    const fetcher = useFetcher();
    const actionFetcher = useFetcher(); // For buttons (Start, Skip, Next)

    // Local State derived from poller — seeded with server data so it renders instantly
    const [roomState, setRoomState] = useState<any>(initialRoomState);
    const [timeLeft, setTimeLeft] = useState(300);
    const [reviewSplitRatio, setReviewSplitRatio] = useState(35);
    const [isResizing, setIsResizing] = useState(false);
    const [teamCount, setTeamCount] = useState(2);

    // --- ANIMATED COUNTER COMPONENT ---
    const AnimatedCounter = ({ value }: { value: number }) => {
        const count = useMotionValue(0);
        const rounded = useTransform(count, Math.round);

        useEffect(() => {
            const animation = animate(count, value, { duration: 2, delay: 0.5, ease: "easeOut" });
            return animation.stop;
        }, [value]);

        return <motion.span>{rounded}</motion.span>;
    };

    // --- MEMOIZED DATA ---
    const officialEvidence = useMemo(() => {
        return roomState?.currentRound?.evidence?.map((ev: any) => {
            try {
                const box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box;
                return { ...ev, box };
            } catch (e) { return null; }
        }).filter(Boolean);
    }, [roomState?.currentRound?.evidence]);

    // --- WEBSOCKET LIVE REPORTS ---
    const [liveReports, setLiveReports] = useState<any[]>([]);

    useEffect(() => {
        let socket: any = null;
        let reconnectTimer: any;

        const connect = () => {
            if (socket || typeof WebSocket === "undefined") return;
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            socket = new WebSocket(`${protocol}//${window.location.host}/api/room/${code}/ws`);
            
            socket.onmessage = (event: any) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "live_ai_report") {
                        setLiveReports((prev: any[]) => [data.payload, ...prev].slice(0, 15));
                    }
                } catch (e) {}
            };
            
            socket.onclose = () => {
                reconnectTimer = setTimeout(connect, 3000);
            };
        };
        
        if (roomState?.room?.status === 'PLAYING') {
            connect();
        } else if (roomState?.room?.status === 'WAITING') {
            setLiveReports([]); // Clear reports on new round start essentially
        }
        
        return () => {
             clearTimeout(reconnectTimer);
             if (socket) socket.close();
        };
    }, [code, roomState?.room?.status]);

    // --- ANIMATION STATE ---
    const [introStage, setIntroStage] = useState(0);

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (e: React.DragEvent, userId: string) => {
        e.dataTransfer.setData("userId", userId);
    };

    const handleDrop = (e: React.DragEvent, teamId: string | null) => {
        e.preventDefault();
        const userId = e.dataTransfer.getData("userId");
        if (userId) {
            const fd = new FormData();
            fd.append("action", "ASSIGN_USER_TEAM");
            fd.append("userId", userId);
            fd.append("teamId", teamId || "NONE");
            actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    useEffect(() => {
        if (roomState?.currentRound?.location?.id) {
            setIntroStage(0);
            setTimeout(() => setIntroStage(1), 100);
            setTimeout(() => setIntroStage(2), 4000);
            setTimeout(() => setIntroStage(3), 5000);
        }
    }, [roomState?.currentRound?.location?.id]);

    // --- RESIZER LOGIC ---
    useEffect(() => {
        const saved = localStorage.getItem("geohunter-teacher-split-ratio");
        if (saved) setReviewSplitRatio(parseFloat(saved));
    }, []);

    const handleResizeMove = (e: any) => {
        if (!isResizing) return;
        const newRatio = (e.clientX / window.innerWidth) * 100;
        setReviewSplitRatio(Math.min(Math.max(newRatio, 15), 60)); // Clamp between 15% and 60%
    };

    const handleResizeEnd = () => {
        setIsResizing(false);
        localStorage.setItem("geohunter-teacher-split-ratio", reviewSplitRatio.toString());
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleResizeMove);
            window.addEventListener('mouseup', handleResizeEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleResizeMove);
            window.removeEventListener('mouseup', handleResizeEnd);
        };
    }, [isResizing]);

    // --- REVIEW MAP LOGIC ---
    const mapRef = useRef<HTMLDivElement>(null);
    const [reviewMap, setReviewMap] = useState<google.maps.Map | null>(null);
    const markersRef = useRef<any[]>([]);
    const clustererRef = useRef<MarkerClusterer | null>(null);
    const hasAutoSkipped = useRef(false);
    const serverClockOffsetRef = useRef<number>(0);

    useEffect(() => {
        if (mapsApiKey) {
            setOptions({ key: mapsApiKey });
            importLibrary("maps");
            importLibrary("marker");
        }
    }, [mapsApiKey]);

    useEffect(() => {
        const room = roomState?.room;
        const currentRound = roomState?.currentRound;
        const status = room?.status;

        if (status === 'REVIEW' && !reviewMap && mapRef.current) {

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
                            div.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; transform: translateY(-50%);";

                            const innerCircle = document.createElement("div");
                            let bgCol = "#3b82f6"; // Default Blue
                            if (g.team_id) {
                                if (g.team_id.toLowerCase().includes('red')) bgCol = "#ef4444";
                                else if (g.team_id.toLowerCase().includes('green')) bgCol = "#22c55e";
                                else if (g.team_id.toLowerCase().includes('yellow')) bgCol = "#eab308";
                                else if (g.team_id.toLowerCase().includes('purple')) bgCol = "#a855f7";
                            }
                            innerCircle.style.cssText = `width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.5); overflow: hidden; background: ${bgCol}; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px; margin: 0 auto;`;

                            // Avatar or Initials
                            if (g.profile_picture_url) {
                                const img = document.createElement("img");
                                img.src = g.profile_picture_url;
                                img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
                                innerCircle.appendChild(img);
                            } else {
                                innerCircle.innerText = (g.display_name && g.display_name.length > 0) ? g.display_name[0].toUpperCase() : "?";
                            }

                            const nameLabel = document.createElement("div");
                            nameLabel.innerText = g.display_name || "Unknown";
                            nameLabel.style.cssText = "background: rgba(0,0,0,0.8); color: white; border-radius: 4px; padding: 2px 6px; font-size: 12px; font-weight: bold; white-space: nowrap; text-shadow: 0 1px 2px black;";

                            div.appendChild(innerCircle);
                            div.appendChild(nameLabel);

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

                            markersRef.current.push(m);

                            bounds.extend({ lat: g.lat, lng: g.lng });
                        });

                        clustererRef.current = new MarkerClusterer({ map, markers: markersRef.current });

                        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
                    }
                });
            });
        }

        if (status !== 'REVIEW' && reviewMap) {
            setReviewMap(null);
            if (clustererRef.current) {
                clustererRef.current.clearMarkers();
            }
            markersRef.current.forEach(m => m.map = null);
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


    // Polling Logic — uses plain fetch() for reliable state updates
    const lastRoundIndexRef = useRef<number>(roomState?.currentRound?.index ?? -1);

    useEffect(() => {
        let alive = true;

        const poll = async () => {
            try {
                const fetchStart = Date.now();
                const res = await fetch(`/api/room/${code}/status`);
                const fetchEnd = Date.now();
                if (!res.ok || !alive) return;
                const data: any = await res.json();
                if (!alive) return;

                if (data.serverTime) {
                    const rtt = fetchEnd - fetchStart;
                    serverClockOffsetRef.current = fetchEnd - (data.serverTime + rtt / 2);
                }

                // Detect Round Change for Animation
                if (data.currentRound?.index !== lastRoundIndexRef.current) {
                    setIntroStage(0);
                    setTimeout(() => setIntroStage(1), 1000);
                    setTimeout(() => setIntroStage(2), 4000);
                    setTimeout(() => setIntroStage(3), 5000);
                    hasAutoSkipped.current = false;
                    lastRoundIndexRef.current = data.currentRound?.index ?? -1;
                }

                setRoomState(data);

                // Sync Timer if playing (Handled by robust local interval now)
                if (data.room?.status === 'PLAYING' && data.currentRound) {
                    const synchronizedNow = Date.now() - serverClockOffsetRef.current;
                    const elapsedSec = Math.floor((synchronizedNow - data.currentRound.startTime) / 1000);
                    const limit = data.currentRound.timeLimit || 120;
                    const remaining = Math.max(0, limit - elapsedSec);
                    if (remaining === 0 && !hasAutoSkipped.current) {
                        hasAutoSkipped.current = true;
                        actionFetcher.submit({ action: "SKIP_TIMER" }, { method: "post", action: `/api/room/${code}/action` });
                    }
                }
            } catch (e) {
                console.error("Poll error:", e);
            }
        };

        // Initial poll
        poll();
        const interval = setInterval(poll, 3000);
        return () => { alive = false; clearInterval(interval); };
    }, [code]);

    useEffect(() => {
        const timerObj = setInterval(() => {
            if (roomState?.room?.status === 'PLAYING' && roomState?.currentRound?.startTime) {
                const synchronizedNow = Date.now() - serverClockOffsetRef.current;
                const elapsedSec = Math.floor((synchronizedNow - roomState.currentRound.startTime) / 1000);
                const limit = roomState.currentRound.timeLimit || 120;
                const remaining = Math.max(0, limit - elapsedSec);
                setTimeLeft(remaining);
                
                if (remaining === 0 && !hasAutoSkipped.current) {
                    hasAutoSkipped.current = true;
                    actionFetcher.submit({ action: "SKIP_TIMER" }, { method: "post", action: `/api/room/${code}/action` });
                }
            }
        }, 1000);
        return () => clearInterval(timerObj);
    }, [roomState?.currentRound?.startTime, roomState?.room?.status]);

    if (!roomState) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Connecting to HQ...</div>;

    const { room, participants, currentRound } = roomState;
    if (!room) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Connecting to HQ...</div>;

    // --- RENDERERS ---

    // --- RENDERERS ---

    const renderLobby = () => (
        <div className="flex flex-col items-center justify-center h-full space-y-12 animate-in fade-in pb-24 overflow-y-auto">
            <div className="text-center space-y-4 pt-12">
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

            {/* Standard "Unassigned" Agents List */}
            {room.game_mode !== 'teams' && (
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
            )}

            {/* Settings Config */}
            <div className="bg-slate-900 border border-white/10 p-6 rounded-xl flex gap-8 items-center flex-wrap justify-center">
                <div className="flex flex-col">
                    <label className="text-xs uppercase font-bold text-slate-400 mb-2">Hint Frequency</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            defaultValue={room.hint_interval || 30}
                            min="5" max="120"
                            className="bg-black/50 border border-white/20 rounded px-3 py-2 text-white font-mono w-20 text-center focus:outline-none focus:border-blue-500"
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

                <div className="w-px h-12 bg-white/10 hidden md:block" />

                <div className="flex flex-col">
                    <label className="text-xs uppercase font-bold text-slate-400 mb-2">Game Mode</label>
                    <div className="flex items-center gap-2">
                        <select
                            defaultValue={room.game_mode || 'standard'}
                            className="bg-black/50 border border-white/20 rounded px-3 py-2 text-white font-mono w-40 focus:outline-none focus:border-blue-500"
                            onChange={(e) => {
                                const fd = new FormData();
                                fd.append("action", "UPDATE_SETTINGS");
                                fd.append("gameMode", e.target.value);
                                actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                            }}
                        >
                            <option value="standard">Standard (Solo)</option>
                            <option value="time_attack">Time Attack</option>
                            <option value="teams">Team Battles</option>
                        </select>
                    </div>
                </div>
                
                {room.game_mode === 'time_attack' && (
                    <>
                        <div className="w-px h-12 bg-white/10 hidden md:block" />
                        <div className="flex flex-col">
                           <label className="text-[10px] uppercase font-bold text-yellow-400 mb-2 whitespace-nowrap">Max Multiplier</label>
                           <div className="flex items-center gap-1">
                               <input
                                   type="number"
                                   step="0.1"
                                   defaultValue={room.ta_max_multiplier || 2.0}
                                   className="bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono w-16 text-center focus:outline-none focus:border-yellow-500"
                                   onBlur={(e) => {
                                       const val = parseFloat(e.target.value);
                                       if (!isNaN(val)) {
                                           const fd = new FormData();
                                           fd.append("action", "UPDATE_SETTINGS");
                                           fd.append("taMax", val.toString());
                                           actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                                       }
                                   }}
                               />
                               <span className="text-xs text-slate-400">x</span>
                           </div>
                        </div>

                        <div className="flex flex-col">
                           <label className="text-[10px] uppercase font-bold text-blue-400 mb-2 whitespace-nowrap">Min Multiplier</label>
                           <div className="flex items-center gap-1">
                               <input
                                   type="number"
                                   step="0.1"
                                   defaultValue={room.ta_min_multiplier || 0.5}
                                   className="bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono w-16 text-center focus:outline-none focus:border-blue-500"
                                   onBlur={(e) => {
                                       const val = parseFloat(e.target.value);
                                       if (!isNaN(val)) {
                                           const fd = new FormData();
                                           fd.append("action", "UPDATE_SETTINGS");
                                           fd.append("taMin", val.toString());
                                           actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                                       }
                                   }}
                               />
                               <span className="text-xs text-slate-400">x</span>
                           </div>
                        </div>
                        
                        <div className="flex flex-col">
                           <label className="text-[10px] uppercase font-bold text-red-400 mb-2 whitespace-nowrap">Grace Wait</label>
                           <div className="flex items-center gap-1">
                               <input
                                   type="number"
                                   defaultValue={room.ta_grace_period ?? 30}
                                   className="bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono w-16 text-center focus:outline-none focus:border-red-500"
                                   onBlur={(e) => {
                                       const val = parseInt(e.target.value);
                                       if (!isNaN(val)) {
                                           const fd = new FormData();
                                           fd.append("action", "UPDATE_SETTINGS");
                                           fd.append("taGrace", val.toString());
                                           actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                                       }
                                   }}
                               />
                               <span className="text-xs text-slate-400">sec</span>
                           </div>
                        </div>
                    </>
                )}
                
                {room.game_mode === 'teams' && (
                    <>
                        <div className="w-px h-12 bg-white/10 hidden md:block" />
                        <div className="flex flex-col">
                            <label className="text-xs uppercase font-bold text-slate-400 mb-2">Number of Teams</label>
                            <select
                                value={teamCount}
                                onChange={(e) => setTeamCount(parseInt(e.target.value))}
                                className="bg-black/50 border border-white/20 rounded px-3 py-2 text-white font-mono w-40 focus:outline-none focus:border-blue-500"
                            >
                                <option value={2}>2 Teams</option>
                                <option value={3}>3 Teams</option>
                                <option value={4}>4 Teams</option>
                            </select>
                        </div>
                        <div className="w-px h-12 bg-white/10 hidden md:block" />
                        <div className="flex items-center">
                             <button
                                onClick={() => {
                                    const fd = new FormData();
                                    fd.append("action", "ASSIGN_TEAMS");
                                    fd.append("teamCount", teamCount.toString());
                                    actionFetcher.submit(fd, { method: "post", action: `/api/room/${code}/action` });
                                }}
                                className="px-4 py-2 bg-purple-600/50 hover:bg-purple-500 text-white rounded-lg font-bold text-xs uppercase tracking-widest border border-purple-400 transition-all flex items-center gap-2"
                            >
                                👥 Auto-Assign Teams ({teamCount})
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Team Distribution Drag and Drop */}
            {room.game_mode === 'teams' && (
                <div className="w-full max-w-6xl mt-8 px-4">
                    <h3 className="text-xs text-center uppercase font-bold text-slate-500 mb-4 tracking-widest">Squad Drag & Drop Management</h3>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-start justify-center">
                        {/* Unassigned Area */}
                        <div 
                            className="flex-1 w-full bg-slate-900 border-2 border-dashed border-slate-700 p-6 rounded-2xl min-h-[200px]"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, null)}
                        >
                            <h4 className="text-center font-black uppercase text-slate-500 mb-4 tracking-widest">Unassigned Agents ({participants.filter((p: any) => !p.team_id).length})</h4>
                            <div className="flex flex-wrap gap-3">
                                {participants.filter((p: any) => !p.team_id).map((p: any) => (
                                    <div 
                                        key={p.user_id} 
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, p.user_id)}
                                        className="px-4 py-2 bg-slate-800 rounded-full border border-slate-600 text-sm font-bold text-white cursor-grab active:cursor-grabbing hover:bg-slate-700 hover:border-blue-400 transition-colors"
                                    >
                                        {p.display_name}
                                    </div>
                                ))}
                                {participants.filter((p: any) => !p.team_id).length === 0 && (
                                    <p className="text-center w-full text-slate-600 italic text-sm mt-8">All agents assigned.</p>
                                )}
                            </div>
                        </div>

                        {/* Team Boxes */}
                        <div className="flex-[2] w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {["Red Team", "Blue Team", "Green Team", "Yellow Team"].slice(0, teamCount).map((teamId) => (
                                <div 
                                    key={teamId} 
                                    className={`flex flex-col items-center bg-white/5 p-4 rounded-xl border-2 transition-all min-h-[200px] ${
                                        teamId.includes('Red') ? 'border-red-900/50 hover:border-red-500' :
                                        teamId.includes('Blue') ? 'border-blue-900/50 hover:border-blue-500' :
                                        teamId.includes('Green') ? 'border-green-900/50 hover:border-green-500' :
                                        'border-yellow-900/50 hover:border-yellow-500'
                                    }`}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, teamId)}
                                >
                                    <div className={`text-sm font-black uppercase tracking-widest mb-4 inline-block px-3 py-1 rounded-full ${
                                        teamId.includes('Red') ? 'bg-red-500/20 text-red-400' :
                                        teamId.includes('Blue') ? 'bg-blue-500/20 text-blue-400' :
                                        teamId.includes('Green') ? 'bg-green-500/20 text-green-400' :
                                        'bg-yellow-500/20 text-yellow-400'
                                    }`}>
                                        {teamId}
                                    </div>
                                    <div className="flex flex-col gap-2 w-full">
                                        {participants.filter((p: any) => p.team_id === teamId).map((p: any) => (
                                            <div 
                                                key={p.user_id} 
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, p.user_id)}
                                                className={`text-sm font-bold text-slate-200 text-center bg-black/40 rounded-lg py-2 border shadow-sm cursor-grab active:cursor-grabbing hover:brightness-125 transition-all ${
                                                    teamId.includes('Red') ? 'border-red-500/30' :
                                                    teamId.includes('Blue') ? 'border-blue-500/30' :
                                                    teamId.includes('Green') ? 'border-green-500/30' :
                                                    'border-yellow-500/30'
                                                }`}
                                            >
                                                {p.display_name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed bottom-12 inset-x-0 flex justify-center z-50">
                <button
                    onClick={() => actionFetcher.submit({ action: "START_GAME" }, { method: "post", action: `/api/room/${code}/action` })}
                    className="px-16 py-6 bg-blue-600 hover:bg-blue-500 text-white text-3xl font-black uppercase tracking-widest rounded-full shadow-[0_0_30px_rgba(37,99,235,0.6)] hover:scale-105 transition-all outline outline-offset-2 outline-4 outline-black"
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

                        {/* [UI] REWARD ROUND INDICATOR */}
                        {currentRound?.isRewardRound && (
                            <div className="mt-4 animate-bounce">
                                <div className="bg-gradient-to-r from-yellow-500 to-amber-500 text-black px-6 py-2 rounded-full border-2 border-yellow-300 shadow-xl font-black uppercase tracking-widest text-sm flex items-center gap-2">
                                    <span>💰</span> REWARD ROUND: 2X POINTS ACTIVE <span>💰</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-xl border border-white/10 flex flex-col items-center">
                        <span className="text-xs text-slate-400 uppercase tracking-widest mb-1">Active Agents</span>
                        <span className="text-lg font-mono font-bold text-green-300">{participants.length} Online</span>
                    </div>
                </div>

                {/* [UI] Persistent Intel Signal Banner */}
                {currentRound?.evidenceCount !== undefined && introStage >= 3 && (
                    <div className="absolute top-32 left-1/2 -translate-x-1/2 z-40 w-max animate-in slide-in-from-top-10 duration-700">
                        <div className="bg-black/60 backdrop-blur-xl border border-blue-500/40 px-6 py-2 rounded-2xl shadow-[0_0_15px_rgba(59,130,246,0.3)] flex flex-col items-center">
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <span className="text-xl">📡</span>
                                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] leading-none mb-1">Sector Scan Results</span>
                                    <span className="text-sm font-black text-white uppercase tracking-tighter tabular-nums">
                                        {currentRound.evidenceCount} <span className="text-blue-300/80">Intel Signals Detected</span>
                                    </span>
                                </div>
                            </div>
                            <div className="mt-1.5 w-full h-0.5 bg-blue-900/40 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 animate-[shimmer_2s_infinite] w-1/3" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Intro Splash */}
                {introStage < 3 && currentRound?.location && (
                    <div className={`absolute inset-0 z-[60] flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-black/60 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="text-center">
                            <div className="mb-2 text-[10px] font-mono text-blue-300 tracking-widest uppercase">Incoming Transmission</div>
                            <h1 className="text-6xl font-black text-white tracking-tighter mb-2">SECTOR {currentRound.location.id?.slice(-4).toUpperCase()}</h1>
                            <div className="text-4xl font-black text-yellow-400">{"★".repeat(Math.ceil((currentRound.location.difficulty_rating || 1) / 2))}</div>
                            {currentRound?.isRewardRound && (
                                <div className="mt-4 bg-yellow-500 text-black px-6 py-2 rounded-full text-xl font-black uppercase tracking-widest animate-pulse">
                                    💰 Reward Round: 2X Points!
                                </div>
                            )}
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

                {/* [UI] Time Attack HUD */}
                {room?.game_mode === 'time_attack' && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[45] pointer-events-none w-full max-w-sm">
                        <TeacherHighPrecisionHUD currentRound={currentRound} room={room} serverClockOffsetRef={serverClockOffsetRef} />
                    </div>
                )}

                {/* Live AI Report Feed */}
                <div className="absolute top-32 left-12 bottom-12 w-80 z-[45] pointer-events-none flex flex-col justify-end">
                    <div className="space-y-3 flex flex-col-reverse overflow-hidden max-h-full">
                        {liveReports.map((report, i) => (
                            <div key={i} className={`bg-slate-900/90 backdrop-blur-md border ${report.aiFeedback?.results?.some((r: any) => r.validity >= 0.7) ? 'border-green-500/50' : 'border-blue-500/30'} p-3 rounded-xl shadow-2xl animate-in fade-in slide-in-from-left-8 duration-500 pointer-events-auto filter drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]`}>
                                <div className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                    {report.displayName} Submitted
                                </div>
                                {report.aiFeedback?.results?.length > 0 ? (
                                    <div className="space-y-2 mt-2">
                                        {report.aiFeedback.results.slice(0, 2).map((r: any, idx: number) => (
                                            <div key={idx} className="bg-black/50 p-2 rounded border border-white/5">
                                                <div className="text-white text-xs font-bold leading-tight">{r.description}</div>
                                                <div className="mt-1 flex items-center justify-between">
                                                    <span className={`text-[9px] font-black uppercase ${r.validity >= 0.7 ? "text-green-400" : (r.validity >= 0.4 ? "text-yellow-400" : "text-red-400")}`}>
                                                        {Math.round(r.validity * 100)}% Match
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        {report.aiFeedback.results.length > 2 && (
                                            <div className="text-[9px] text-slate-500 italic font-medium px-1">+{report.aiFeedback.results.length - 2} more discoveries</div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-slate-400 italic mt-1">No intel detected.</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

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
                        <div className="flex flex-col items-center mt-1">
                            <span className="text-[10px] text-blue-300">
                                {roomState.currentRound?.submissionCount || 0} / {participants.length} Reported
                            </span>
                            {(roomState.currentRound?.submissionCount || 0) > 0 && (
                                <span className="text-[9px] text-green-400 mt-0.5 animate-pulse uppercase tracking-[0.2em] font-mono font-bold">
                                    {roomState.currentRound?.submissionCount || 0} AI Analyzed
                                </span>
                            )}
                        </div>
                    </button>
                </div>
            </div>
        );
    }

    // --- REVIEW MAP LOGIC MOVED TO TOP ---

    const renderReview = () => {
        return (
            <div className="h-full flex overflow-hidden">
                {/* COLUMN 1: IMAGE & EVIDENCE (Adjustable %) */}
                <div className="bg-black relative border-r border-white/10 flex flex-col"
                    style={{ width: `${reviewSplitRatio}%` }}
                >
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
                                            {(() => {
                                                let dynamicAI = ev.ai_analysis;
                                                if (!dynamicAI || dynamicAI === "Real-time analysis active.") {
                                                    dynamicAI = undefined;
                                                    for (const r of liveReports) {
                                                        const match = r.aiFeedback?.results?.find((x: any) => x.description === ev.description);
                                                        if (match && match.explanation) {
                                                            dynamicAI = match.explanation;
                                                            break;
                                                        }
                                                    }
                                                }
                                                
                                                return dynamicAI ? (
                                                    <>
                                                        <span className="text-yellow-400 font-black block mb-1 uppercase tracking-wider text-[9px]">🤖 Live AI Analysis</span>
                                                        <span className="text-slate-200 font-medium leading-relaxed block mb-2">{dynamicAI}</span>
                                                        <span className="text-blue-300 font-bold block border-t border-white/10 pt-2 mt-1 uppercase tracking-wider text-[9px]">
                                                            🕵️ Found by {ev.discovery_count || 0} Agent{(ev.discovery_count || 0) === 1 ? '' : 's'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="block mb-2">{ev.description}</span>
                                                        <span className="text-blue-300 font-bold block border-t border-white/10 pt-2 mt-1 uppercase tracking-wider text-[9px]">
                                                            🕵️ Found by {ev.discovery_count || 0} Agent{(ev.discovery_count || 0) === 1 ? '' : 's'}
                                                        </span>
                                                    </>
                                                );
                                            })()}
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

                {/* DRAGGABLE DIVIDER */}
                <div
                    onMouseDown={() => setIsResizing(true)}
                    className="w-2 hover:w-4 group bg-black/40 hover:bg-emerald-500/50 cursor-col-resize items-center justify-center transition-all z-[80] relative border-x border-white/10 select-none"
                >
                    <div className="w-0.5 h-12 bg-white/20 group-hover:bg-white/60 rounded-full" />
                </div>

                {/* COLUMN 2: MAP (40%) */}
                <div className="relative bg-slate-800 border-r border-white/10"
                    style={{ width: `${75 - reviewSplitRatio}%` }}
                >
                    <div ref={mapRef} className="absolute inset-0 w-full h-full" />
                    <div className="absolute bottom-4 left-4 z-10 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs text-white border border-white/10">
                        Map Data: Hybrid/Labels
                    </div>
                </div>

                {/* COLUMN 3: LEADERBOARD/CONTROLS (25%) */}
                <LiveLeaderboard
                    room={room}
                    participants={participants}
                    officialEvidence={officialEvidence}
                    code={code}
                    actionFetcher={actionFetcher}
                />

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
                                            
                                            <div className="flex items-center gap-2 mb-4 bg-blue-500/10 border border-blue-500/20 px-3 py-2 rounded-lg w-fit">
                                                <span className="text-xl">🕵️</span>
                                                <span className="text-blue-300 font-bold text-sm uppercase tracking-widest">
                                                    Discovered by {focusedItem.discovery_count || 0} Agent{(focusedItem.discovery_count || 0) === 1 ? '' : 's'}
                                                </span>
                                            </div>

                                            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                                <h3 className="text-blue-300 text-[10px] font-bold uppercase tracking-widest mb-2">AI Analysis</h3>
                                            {(() => {
                                                let dynamicAI = focusedItem.ai_analysis;
                                                if (!dynamicAI || dynamicAI === "Real-time analysis active.") {
                                                    dynamicAI = undefined;
                                                    for (const r of liveReports) {
                                                        const match = r.aiFeedback?.results?.find((x: any) => x.description === focusedItem.description);
                                                        if (match && match.explanation) {
                                                            dynamicAI = match.explanation;
                                                            break;
                                                        }
                                                    }
                                                }
                                                return (
                                                    <p className="text-slate-300 text-sm leading-relaxed">
                                                        {dynamicAI || "No agents have submitted clear scans of this intelligence yet."}
                                                    </p>
                                                );
                                            })()}
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

    const renderPodium = () => {
        let sortedEntities: any[] = [];
        let isTeamMode = room.game_mode === 'teams';

        if (isTeamMode) {
            const teamScores = participants.reduce((acc: any, p: any) => {
                if (p.team_id) {
                    acc[p.team_id] = (acc[p.team_id] || 0) + p.score;
                }
                return acc;
            }, {});
            sortedEntities = Object.entries(teamScores)
                .map(([name, score]) => ({ display_name: name, score }))
                .sort((a, b) => (b.score as number) - (a.score as number));
        } else {
            sortedEntities = [...participants].sort((a, b) => b.score - a.score);
        }

        return (
            <div className="h-full flex flex-col items-center justify-center space-y-12 animate-in fade-in">
                <h1 className="text-8xl font-black text-yellow-400 tracking-tighter drop-shadow-2xl">MISSION ACCOMPLISHED</h1>

                <div className="flex items-end gap-8">
                    {/* 2nd Place */}
                    {sortedEntities[1] && (
                        <motion.div 
                            initial={{ y: 200, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ duration: 0.8, delay: 1, type: "spring", bounce: 0.5 }}
                            className="flex flex-col items-center"
                        >
                            <div className={`w-32 h-32 rounded-full border-4 border-white mb-4 flex items-center justify-center text-4xl font-black ${isTeamMode && sortedEntities[1].display_name.includes('Red') ? 'bg-red-500 text-white' : isTeamMode && sortedEntities[1].display_name.includes('Blue') ? 'bg-blue-500 text-white' : isTeamMode && sortedEntities[1].display_name.includes('Green') ? 'bg-green-500 text-white' : 'bg-slate-300 text-slate-800'}`}>
                                {sortedEntities[1].display_name?.[0] || "?"}
                            </div>
                            <div className="h-48 w-40 bg-slate-700 rounded-t-2xl flex items-end justify-center pb-4">
                                <span className="text-4xl font-black text-white">#2</span>
                            </div>
                            <div className="mt-4 text-center">
                                <h3 className="text-2xl font-bold text-white">{sortedEntities[1].display_name}</h3>
                                <p className="text-xl text-slate-400"><AnimatedCounter value={sortedEntities[1].score || 0} /> pts</p>
                            </div>
                        </motion.div>
                    )}

                    {/* 1st Place */}
                    {sortedEntities[0] && (
                        <motion.div 
                            initial={{ y: 300, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ duration: 1, delay: 2, type: "spring", bounce: 0.6 }}
                            className="flex flex-col items-center z-10"
                        >
                            <motion.div 
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 3, type: "spring" }}
                                className="text-6xl mb-6"
                            >
                                👑
                            </motion.div>
                            <div className={`w-40 h-40 rounded-full border-4 border-white mb-4 flex items-center justify-center text-5xl font-black shadow-[0_0_50px_rgba(250,204,21,0.5)] ${isTeamMode && sortedEntities[0].display_name.includes('Red') ? 'bg-red-500 text-white' : isTeamMode && sortedEntities[0].display_name.includes('Blue') ? 'bg-blue-500 text-white' : isTeamMode && sortedEntities[0].display_name.includes('Green') ? 'bg-green-500 text-white' : 'bg-yellow-400 text-yellow-900'}`}>
                                {sortedEntities[0].display_name?.[0] || "?"}
                            </div>
                            <div className="h-64 w-48 bg-yellow-600 rounded-t-2xl flex items-end justify-center pb-4 relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                                <span className="text-6xl font-black text-white relative z-10">#1</span>
                            </div>
                            <div className="mt-4 text-center">
                                <h3 className="text-3xl font-black text-white">{sortedEntities[0].display_name}</h3>
                                <p className="text-2xl text-yellow-400 font-bold"><AnimatedCounter value={sortedEntities[0].score || 0} /> pts</p>
                            </div>
                        </motion.div>
                    )}

                    {/* 3rd Place */}
                    {sortedEntities[2] && (
                        <motion.div 
                            initial={{ y: 150, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ duration: 0.8, delay: 0.5, type: "spring", bounce: 0.4 }}
                            className="flex flex-col items-center"
                        >
                            <div className={`w-28 h-28 rounded-full border-4 border-white mb-4 flex items-center justify-center text-3xl font-black ${isTeamMode && sortedEntities[2].display_name.includes('Red') ? 'bg-red-500 text-white' : isTeamMode && sortedEntities[2].display_name.includes('Blue') ? 'bg-blue-500 text-white' : isTeamMode && sortedEntities[2].display_name.includes('Green') ? 'bg-green-500 text-white' : 'bg-orange-400 text-orange-900'}`}>
                                {sortedEntities[2].display_name?.[0] || "?"}
                            </div>
                            <div className="h-40 w-40 bg-orange-700 rounded-t-2xl flex items-end justify-center pb-4">
                                <span className="text-4xl font-black text-white">#3</span>
                            </div>
                            <div className="mt-4 text-center">
                                <h3 className="text-xl font-bold text-white">{sortedEntities[2].display_name}</h3>
                                <p className="text-lg text-slate-400"><AnimatedCounter value={sortedEntities[2].score || 0} /> pts</p>
                            </div>
                        </motion.div>
                    )}
                </div>

                <div className="mt-12">
                    <Link to="/teacher/dashboard" className="px-8 py-4 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold uppercase tracking-widest">
                        Return to Base
                    </Link>
                </div>
            </div>
        );
    };

    return (
        <div className="w-screen h-screen bg-slate-950 overflow-hidden font-sans">
            {room.status === 'WAITING' && renderLobby()}
            {room.status === 'PLAYING' && renderPlaying()}
            {room.status === 'REVIEW' && renderReview()}
            {room.status === 'PODIUM' && renderPodium()}
        </div>
    );
}
