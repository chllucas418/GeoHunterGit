import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireUser } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";

export async function loader({ request, params, context }: any) {
    const userId = await requireUser(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // 1. Get Room & Current Round to check for existing submission
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    let existingGuess = null;

    if (room && room.status !== 'WAITING') {
        const item = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, room.current_index).first<any>();

        if (item) {
            const guessRecord = await db.prepare(
                "SELECT * FROM room_guesses WHERE room_code = ? AND location_id = ? AND user_id = ?"
            ).bind(code, item.location_id, userId).first<any>();

            if (guessRecord) {
                // Parse JSON fields
                let aiFeedback = null;
                try {
                    aiFeedback = guessRecord.ai_feedback ? JSON.parse(guessRecord.ai_feedback) : null;
                } catch (e) {
                    console.error("Failed to parse ai_feedback", e);
                }

                existingGuess = {
                    lat: guessRecord.lat,
                    lng: guessRecord.lng,
                    score: guessRecord.score,
                    distance: guessRecord.distance, // stored in km? code says "distance * 1000" in submit return but DB might store raw?
                    // Wait, submit.ts stores: "distance" (km) and "score".
                    // But the return JSON had "distance: distance * 1000".
                    // Let's standardise on meters for the UI.
                    distanceMeters: guessRecord.distance * 1000,
                    ai_feedback: aiFeedback,
                    evidence_found: guessRecord.evidence_found // IDs string
                };
            }
        }
    }

    return { code, userId, mapsApiKey: env.GOOGLE_MAPS_API_KEY, existingGuess };
}

export default function StudentLiveGame() {
    const { code, userId, mapsApiKey, existingGuess } = useLoaderData() as any;
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

    // Tutorial Flow State
    const [tutorialStep, setTutorialStep] = useState(0);

    // AI Socratic Hint State
    const [aiQuestion, setAiQuestion] = useState("");
    const [aiHintResponse, setAiHintResponse] = useState<string | null>(null);
    const [isAskingAi, setIsAskingAi] = useState(false);
    const [hasAskedAi, setHasAskedAi] = useState(false);

    // Derived Data
    const room = roomState?.room;
    const currentRound = roomState?.currentRound;
    const location = currentRound?.location;

    // Parse Metadata & Hints when location changes
    const hintList = location?.hints ? (typeof location.hints === 'string' ? (location.hints.startsWith('[') ? JSON.parse(location.hints) : location.hints.split('\n')) : location.hints) : [];

    // Initialize state from existingGuess if available
    useEffect(() => {
        if (existingGuess && !submitted) {
            // Only restore if we match the current round index?
            // The loader logic fetches based on room.current_index, so it should be correct for the *current* active round.
            // However, if the poller updates roomState, we want to make sure we don't overwrite if we moved to next round.
            // But existingGuess comes from loader which ran on page load.
            // If page loads, we trust loader.

            setGuess({ lat: existingGuess.lat, lng: existingGuess.lng });
            setSubmitted(true);
            setResult({
                score: existingGuess.score,
                distance: existingGuess.distanceMeters,
                fullFeedback: existingGuess.ai_feedback,
                // We don't have evidenceScore separated easily unless we recalc or store it.
                // For now, total score is enough.
                evidenceScore: 0 // Optional display
            });

            // If we have a map already, place marker
            if (mapInstance) {
                const pos = { lat: existingGuess.lat, lng: existingGuess.lng };
                if (isFinite(pos.lat) && isFinite(pos.lng)) {
                    if (!cursorMarkerRef.current) {
                        cursorMarkerRef.current = new google.maps.Marker({
                            position: pos,
                            map: mapInstance,
                        });
                        setMarker(cursorMarkerRef.current);
                    } else {
                        cursorMarkerRef.current.setPosition(pos);
                    }
                    mapInstance.panTo(pos);
                } else {
                    console.error("Invalid coordinates in existingGuess:", pos);
                }
            }
        }
    }, [existingGuess, mapInstance]);


    // Intro Animation trigger on new round
    useEffect(() => {
        if (location?.id) {
            // Force State Cleanup on Location Change (Redundant Safety)
            if (cursorMarkerRef.current) {
                cursorMarkerRef.current.setMap(null);
                cursorMarkerRef.current = null;
            }
            setMarker(null);
            setGuess(null);
            setSubmitted(false);
            setEvidenceList([]);
            setHasZoomed(false);

            // Reset Tutorial for this round if applicable
            if (roomState?.room?.has_guided_playthrough && roomState?.room?.current_index === 0) {
                setTutorialStep(1);
            }
        }
    }, [location?.id]);

    // 1. Polling & Sync (State + Timer)
    useEffect(() => {
        fetcher.load(`/api/room/${code}/status`);
        const interval = setInterval(() => {
            if (fetcher.state === "idle") {
                fetcher.load(`/api/room/${code}/status`);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [code]);

    // Timer Interval (Runs every 1s locally)
    useEffect(() => {
        const timer = setInterval(() => {
            if (roomState?.currentRound?.startTime) {
                const now = Date.now();
                const start = roomState.currentRound.startTime;
                const diff = Math.floor((now - start) / 1000);
                setSecondsElapsed(diff >= 0 ? diff : 0);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [roomState?.currentRound?.startTime]);

    useEffect(() => {
        if (fetcher.data) {
            const newData = fetcher.data as any;
            const newIndex = newData.room?.current_index;

            // Detect Round Change for Animation
            if (lastRoundIndex.current !== newIndex) {
                setIntroStage(0);
                setTimeout(() => setIntroStage(1), 500);
                setTimeout(() => setIntroStage(2), 3500);
                setTimeout(() => setIntroStage(3), 4500);
            }

            // Detect Round Change using Ref to prevent stale closures
            if (lastRoundIndex.current !== -1 && lastRoundIndex.current !== newIndex) {
                setGuess(null);
                setSubmitted(false);
                setResult(null);
                setEvidenceList([]); // Clear evidence
                setVisibleHints([]); // Clear hints
                setHasZoomed(false);

                // Clear AI States
                setHasAskedAi(false);
                setAiHintResponse(null);
                setAiQuestion("");
                setIsAskingAi(false);

                // Cleanup Marker using Ref
                if (cursorMarkerRef.current) {
                    cursorMarkerRef.current.setMap(null);
                    cursorMarkerRef.current = null;
                }
                if (officialMarkerRef.current) {
                    officialMarkerRef.current.setMap(null);
                    officialMarkerRef.current = null;
                }
                if (polylineRef.current) {
                    polylineRef.current.setMap(null);
                    polylineRef.current = null;
                }
                setMarker(null);

                if (mapInstance) {
                    mapInstance.setZoom(11);
                    mapInstance.setCenter({ lat: 22.3193, lng: 114.1694 });
                }
            }

            lastRoundIndex.current = newIndex;
            setRoomState(newData);

            // Removed duplicate fetch logic in favor of robust useEffect below
        }
    }, [fetcher.data]);

    // 2. Map & WebSocket Init
    const mapRef = useRef<HTMLDivElement>(null);
    const cursorMarkerRef = useRef<google.maps.Marker | null>(null); // Ref for reliable cleanup
    const officialMarkerRef = useRef<any>(null);
    const polylineRef = useRef<google.maps.Polyline | null>(null);

    // --- DRAW OVERLAY REFS ---
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const mapCanvasRef = useRef<HTMLCanvasElement>(null);

    // WS Refs
    const wsRef = useRef<WebSocket | null>(null);
    const incomingLaserMarkerRef = useRef<google.maps.Marker | null>(null);

    // Setup WebSocket for Live Comms
    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/room/${code}/ws`;

        let socket: WebSocket;
        let reconnectTimer: NodeJS.Timeout;

        const connect = () => {
            socket = new WebSocket(wsUrl);
            socket.onopen = () => console.log("Live WS Connected");
            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "laser" && mapInstance) {
                        // Show laser pointer from teacher
                        if (!incomingLaserMarkerRef.current) {
                            incomingLaserMarkerRef.current = new google.maps.Marker({
                                position: { lat: data.lat, lng: data.lng },
                                map: mapInstance,
                                icon: {
                                    path: google.maps.SymbolPath.CIRCLE,
                                    scale: 15,
                                    fillColor: "#ef4444",
                                    fillOpacity: 0.8,
                                    strokeColor: "#ffffff",
                                    strokeWeight: 3,
                                },
                                zIndex: 9999
                            });
                        } else {
                            incomingLaserMarkerRef.current.setPosition({ lat: data.lat, lng: data.lng });
                        }

                        setTimeout(() => {
                            if (incomingLaserMarkerRef.current) {
                                incomingLaserMarkerRef.current.setMap(null);
                                incomingLaserMarkerRef.current = null;
                            }
                        }, 3000); // laser ping lasts 3 sec
                    } else if (data.type === "draw") {
                        const targetCanvas = data.canvasTarget === 'image' ? imageCanvasRef.current : mapCanvasRef.current;
                        if (targetCanvas) {
                            const ctx = targetCanvas.getContext('2d');
                            if (ctx) {
                                ctx.beginPath();
                                ctx.moveTo(data.x0 * targetCanvas.width, data.y0 * targetCanvas.height);
                                ctx.lineTo(data.x1 * targetCanvas.width, data.y1 * targetCanvas.height);
                                ctx.strokeStyle = '#ef4444';
                                ctx.lineWidth = 4;
                                ctx.lineCap = 'round';
                                ctx.stroke();
                                ctx.closePath();
                            }
                        }
                    } else if (data.type === "draw_clear") {
                        [imageCanvasRef.current, mapCanvasRef.current].forEach(canvas => {
                            if (canvas) {
                                const ctx = canvas.getContext('2d');
                                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                            }
                        });
                    } else if (data.type === "pause_toggle") {
                        fetcher.load(`/api/room/${code}/status`);
                    }
                } catch (e) { }
            };
            socket.onclose = () => {
                console.log("Live WS Closed, reconnecting...");
                reconnectTimer = setTimeout(connect, 3000);
            };
            wsRef.current = socket;
        };

        if (room?.status === 'PLAYING' || room?.status === 'REVIEW') {
            connect();
        }

        return () => {
            clearTimeout(reconnectTimer);
            if (socket) socket.close();
        };
    }, [code, mapInstance, room?.status]);

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

                // Ticker: send mouse move to teacher
                map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            type: "cursor",
                            id: userId,
                            lat: e.latLng!.lat(),
                            lng: e.latLng!.lng()
                        }));
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
    const HINT_INTERVAL = room?.hint_interval || 30; // Default to 30s if not set
    const timeUntilNext = Math.max(0, HINT_INTERVAL - (secondsElapsed % HINT_INTERVAL));
    const isVicinityScanAvailable = secondsElapsed >= (hintList.length + 1) * HINT_INTERVAL;

    const [isTargetInRange, setIsTargetInRange] = useState(false);

    // Track proximity for button state
    useEffect(() => {
        if (!mapInstance || !location?.lat || !location?.lng) return;

        const checkProximity = () => {
            const currentCenter = mapInstance.getCenter();
            if (!currentCenter) return;

            const distLat = Math.abs(currentCenter.lat() - location.lat);
            const distLng = Math.abs(currentCenter.lng() - location.lng);
            // 0.003 degrees approx 300m
            const inRange = (distLat < 0.003 && distLng < 0.003);
            setIsTargetInRange(inRange);
        };

        const listener = mapInstance.addListener("idle", checkProximity);
        return () => google.maps.event.removeListener(listener);
    }, [mapInstance, location]);

    useEffect(() => {
        if (submitted || !location) return;

        // Calculate hints based strictly on interval
        // T=0 -> 0 hints
        // T=10 (if interval=10) -> 1 hint
        const count = Math.floor(secondsElapsed / HINT_INTERVAL);

        if (count > 0 && count <= hintList.length) {
            if (visibleHints.length < count) {
                setVisibleHints(hintList.slice(0, count));
                // Removed auto-zoom logic here. Hints just appear textually.
            }
        }
    }, [secondsElapsed, hintList, mapInstance, hasZoomed, submitted, HINT_INTERVAL, location, visibleHints.length]);

    const handleVicinityScan = () => {
        if (!mapInstance || !location || !location.lat || !location.lng) return;

        const currentCenter = mapInstance.getCenter();
        const distLat = Math.abs(currentCenter!.lat() - location.lat);
        const distLng = Math.abs(currentCenter!.lng() - location.lng);
        // 0.003 degrees is approx 300m
        const isClose = (distLat < 0.003 && distLng < 0.003);

        if (isClose) {
            // Already close
            alert("SAT-NAV: Target signal strong in current sector. No scan needed.");
            return;
        }

        setHasZoomed(true);
        const offsetLat = (Math.random() - 0.5) * 0.006;
        const offsetLng = (Math.random() - 0.5) * 0.006;
        mapInstance.panTo({
            lat: location.lat + offsetLat,
            lng: location.lng + offsetLng
        });
        mapInstance.setZoom(17);
        setVisibleHints(prev => [...prev, "Satellite Scan: Vicinity Locked."]);
    };

    // --- HANDLERS ---
    const handleAskAi = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!aiQuestion.trim() || hasAskedAi) return;
        setIsAskingAi(true);
        try {
            const fd = new FormData();
            fd.append("query", aiQuestion);
            const res = await fetch(`/api/room/${code}/hint`, { method: "POST", body: fd });
            const data = await res.json() as any;
            if (data.hint) {
                setAiHintResponse(data.hint);
                setHasAskedAi(true);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsAskingAi(false);
            setAiQuestion("");
        }
    };

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

    // Watch result from submission
    useEffect(() => {
        if (actionFetcher.data) {
            setResult(actionFetcher.data);
        }
    }, [actionFetcher.data]);

    // Fetch Full Result when entering REVIEW mode
    useEffect(() => {
        if (room?.status === 'REVIEW' && !result?.officialEvidence) {
            // Fetch result from dedicated endpoint
            fetch(`/api/room/${code}/round_result`)
                .then(async res => {
                    if (!res.ok) {
                        const text = await res.text();
                        console.error("Fetch Result Error:", res.status, text);
                        throw new Error(`Server Error: ${res.status}`);
                    }
                    return res.json();
                })
                .then((data: any) => {
                    if (data.score !== undefined) {
                        setResult((prev: any) => ({ ...prev, ...data }));
                    } else if (data.notSubmitted) {
                        setResult((prev: any) => ({
                            ...prev,
                            message: data.message || "No report filed.",
                            officialEvidence: data.officialEvidence, // Still need official evidence for map/canvas
                            officialLocation: data.officialLocation,
                            score: 0,
                            distance: -1
                        }));
                    } else if (data.error) {
                        console.error("API Returned Error:", data.error);
                        setResult((prev: any) => ({ ...prev, message: data.error }));
                    }
                })
                .catch(err => {
                    console.error("Failed to fetch results", err);
                    setResult((prev: any) => ({ ...prev, message: "Error fetching data. Check Console." }));
                });
        }
    }, [room?.status, code, result?.officialEvidence]);

    // Draw Official Pin & Line in REVIEW mode
    useEffect(() => {
        if (room?.status === 'REVIEW' && result?.officialLocation && mapInstance) {
            importLibrary("marker").then(async () => {
                const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

                if (!officialMarkerRef.current) {
                    const pin = new PinElement({
                        background: "#EF4444",
                        borderColor: "#7F1D1D",
                        glyphColor: "white",
                        scale: 1.2
                    });

                    officialMarkerRef.current = new AdvancedMarkerElement({
                        position: { lat: result.officialLocation.lat, lng: result.officialLocation.lng },
                        map: mapInstance,
                        title: "Official Location",
                        content: pin.element
                    });

                    if (guess && !polylineRef.current) {
                        polylineRef.current = new google.maps.Polyline({
                            path: [guess, { lat: result.officialLocation.lat, lng: result.officialLocation.lng }],
                            geodesic: true,
                            strokeColor: "#EF4444",
                            strokeOpacity: 0,
                            strokeWeight: 2,
                            icons: [{
                                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
                                offset: '0',
                                repeat: '20px'
                            }],
                            map: mapInstance
                        });
                    }

                    const bounds = new google.maps.LatLngBounds();
                    bounds.extend({ lat: result.officialLocation.lat, lng: result.officialLocation.lng });
                    if (guess) bounds.extend(guess);
                    mapInstance.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
                }
            });
        }
    }, [room?.status, result?.officialLocation, mapInstance, guess]);

    // Resize Sync Canvases
    useEffect(() => {
        const resizeCanvas = () => {
            if (imageCanvasRef.current) {
                imageCanvasRef.current.width = imageCanvasRef.current.offsetWidth;
                imageCanvasRef.current.height = imageCanvasRef.current.offsetHeight;
            }
            if (mapCanvasRef.current) {
                mapCanvasRef.current.width = mapCanvasRef.current.offsetWidth;
                mapCanvasRef.current.height = mapCanvasRef.current.offsetHeight;
            }
        };
        window.addEventListener('resize', resizeCanvas);
        setTimeout(resizeCanvas, 500); // Trigger after layout mounts
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [location?.id]);

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

            {/* FREEZE RAY OVERLAY */}
            {room.is_paused === 1 && (
                <div className="absolute inset-0 z-[9999] bg-black/40 backdrop-blur-2xl flex flex-col items-center justify-center p-6 pointer-events-auto">
                    <h1 className="text-6xl md:text-8xl font-black text-white uppercase tracking-tighter mb-4 animate-pulse">
                        Eyes on Board
                    </h1>
                    <p className="text-blue-300 font-mono text-sm tracking-widest bg-blue-900/40 px-6 py-3 rounded-full border border-blue-500/30">
                        INSTRUCTOR BRIEFING IN PROGRESS
                    </p>
                </div>
            )}

            {/* COLUMN 1: EVIDENCE / IMAGE */}
            <div className={`relative h-full transition-all duration-700 ease-in-out border-r border-white/10 overflow-hidden
                ${layoutMode === "result" ? "w-full md:w-[40%]" : "w-full md:w-1/2"}`}
            >
                {/* Header / Timer & Hints */}
                {room.status === 'PLAYING' && (
                    <div className="absolute top-0 inset-x-0 z-[60] p-4 flex justify-between items-start pointer-events-none">
                        <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 flex flex-col items-center mx-auto pointer-events-auto">
                            <div suppressHydrationWarning className={`text-4xl font-black font-mono tracking-tighter drop-shadow-lg ${((currentRound.timeLimit || 120) - secondsElapsed) < 30 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                                {Math.floor(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) / 60)}:{(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) % 60).toString().padStart(2, '0')}
                            </div>
                            {/* Hint Timer - Only show if hints remaining */}
                            {(Math.floor(secondsElapsed / (room.hint_interval || 30)) + 1) <= hintList.length && (
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                                    <span className="text-[10px] text-yellow-100 font-mono uppercase">
                                        Hint in {Math.max(0, (room.hint_interval || 30) - (secondsElapsed % (room.hint_interval || 30)))}s
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Intro Splash */}
                {introStage < 3 && location && (
                    <div className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-black/60 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="text-center">
                            <div className="mb-2 text-[10px] font-mono text-blue-300 tracking-widest uppercase">Incoming Transmission</div>
                            <h1 className="text-6xl font-black text-white tracking-tighter mb-2">SECTOR {location.id?.slice(-4).toUpperCase()}</h1>
                            <div className="text-4xl font-black text-yellow-400">{"★".repeat(Math.ceil((location.difficulty_rating || 1) / 2))}</div>
                            <div className="mt-2 text-[10px] font-mono font-bold text-blue-300 uppercase tracking-widest border border-blue-500/30 px-2 py-1 rounded bg-blue-500/10 inline-block">
                                {currentRound.evidenceCount || 0} Intel Items
                            </div>
                        </div>
                    </div>
                )}

                {/* --- TUTORIAL OVERLAY --- */}
                {room.has_guided_playthrough === 1 && currentRound.index === 0 && tutorialStep > 0 && tutorialStep < 5 && (
                    <div className="absolute inset-0 z-[70] pointer-events-none flex flex-col items-center justify-end pb-12">
                        <div className="bg-blue-600/90 backdrop-blur-xl border-2 border-blue-400 p-6 rounded-2xl max-w-md shadow-2xl pointer-events-auto animate-in slide-in-from-bottom-10">
                            <h3 className="text-xl font-black uppercase tracking-widest text-white mb-2 flex items-center gap-2">
                                <span>🎓</span> Simulation Guide
                            </h3>
                            <p className="text-blue-100 text-sm mb-6 leading-relaxed font-medium">
                                {tutorialStep === 1 && "Welcome Agent. Before we begin, let's review the tools. Your objective is to lock onto the geographical coordinates that match this image."}
                                {tutorialStep === 2 && "First, analyze the image. Click 'Enable Scanner' (top right) and draw a box over a distinct clue you see (e.g. an architectural feature or street sign)."}
                                {tutorialStep === 3 && "Excellent. The AI will evaluate this evidence later. Now, click on the satellite map on the right to place your coordinate pin."}
                                {tutorialStep === 4 && "Finally, click CONFIRM COORDINATES to lock in your submission. High scores are awarded for accuracy within a 100m radius."}
                            </p>
                            <div className="flex justify-between items-center">
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4].map(s => (
                                        <div key={s} className={`w-2 h-2 rounded-full ${s === tutorialStep ? 'bg-white' : 'bg-white/30'}`} />
                                    ))}
                                </div>
                                <button
                                    onClick={() => setTutorialStep(prev => prev + 1)}
                                    disabled={
                                        (tutorialStep === 2 && evidenceList.length === 0) ||
                                        (tutorialStep === 3 && guess === null)
                                    }
                                    className={`px-6 py-2 bg-white text-blue-900 rounded-full font-black uppercase text-xs tracking-widest transition-colors ${((tutorialStep === 2 && evidenceList.length === 0) || (tutorialStep === 3 && guess === null))
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-blue-50'
                                        }`}
                                >
                                    {tutorialStep === 4 ? "Begin Operaton" : "Next ➔"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hints Overlay */}
                {!submitted && visibleHints.length > 0 && (
                    <div className="absolute bottom-32 left-6 z-30 max-w-sm space-y-2 pointer-events-none">
                        {visibleHints.map((hint, i) => (
                            <div key={i} className="bg-black/40 backdrop-blur-xl border-l-4 border-yellow-400 p-3 rounded text-xs text-white animate-in slide-in-from-left-10 shadow-lg">
                                {hint}
                            </div>
                        ))}
                    </div>
                )}

                {/* AI Hint UI */}
                {!submitted && !isEvidenceMode && introStage >= 3 && (tutorialStep === 0 || tutorialStep >= 5) && (
                    <div className="absolute bottom-6 left-6 z-30 w-full max-w-[16rem] pointer-events-auto bg-black/60 backdrop-blur-xl border border-blue-500/30 rounded-xl p-4 shadow-2xl">
                        <h3 className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-2 flex justify-between">
                            <span>Socratic AI Link</span>
                            <span className="text-slate-500">{hasAskedAi ? '0/1' : '1/1'}</span>
                        </h3>
                        {aiHintResponse ? (
                            <div className="text-xs text-blue-100 italic leading-relaxed">"{aiHintResponse}"</div>
                        ) : hasAskedAi ? (
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Connection to AI severed for this sector.</div>
                        ) : (
                            <form onSubmit={handleAskAi} className="flex gap-2">
                                <input
                                    type="text"
                                    value={aiQuestion}
                                    onChange={e => setAiQuestion(e.target.value)}
                                    placeholder="Ask for a clue..."
                                    className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500"
                                    disabled={isAskingAi}
                                    maxLength={100}
                                />
                                <button
                                    type="submit"
                                    disabled={isAskingAi || !aiQuestion.trim()}
                                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-[10px] uppercase font-bold transition-colors"
                                >
                                    {isAskingAi ? "..." : "SEND"}
                                </button>
                            </form>
                        )}
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
                            key={location?.id || 'default'}
                            imageUrl={location.image_url}
                            onBoxChange={isEvidenceMode ? handleBoxDrawn : () => { }}
                            disabled={submitted || !isEvidenceMode}
                            hasDrawnBoxes={evidenceList.length > 0}
                        >
                            {/* User Evidence */}
                            {evidenceList.map((ev, index) => {
                                // Default color: Yellow (Guessing phase)
                                let borderColorClass = "border-yellow-400";
                                let bgColorClass = "bg-yellow-400/20";

                                // Review phase: dynamically color based on AI Validity
                                if (room.status === 'REVIEW' && result?.aiFeedback?.results) {
                                    const grading = result.aiFeedback.results.find((r: any) => r.index === index);
                                    if (grading) {
                                        if (grading.validity > 0.7) {
                                            // Correct
                                            borderColorClass = "border-green-400";
                                            bgColorClass = "bg-green-400/20";
                                        } else if (grading.validity <= 0.1) {
                                            // Did not help locating effort (Generic/Sky/Wall)
                                            borderColorClass = "border-blue-500";
                                            bgColorClass = "bg-blue-500/20";
                                        } else {
                                            // Incorrect / Missed actual feature
                                            borderColorClass = "border-red-500";
                                            bgColorClass = "bg-red-500/20";
                                        }
                                    }
                                }

                                return (
                                    <div key={ev.id} className={`absolute border-2 ${borderColorClass} ${bgColorClass} transition-colors duration-500`}
                                        style={{ left: `${ev.box.x / 10}%`, top: `${ev.box.y / 10}%`, width: `${ev.box.w / 10}%`, height: `${ev.box.h / 10}%` }}
                                    >
                                        {!submitted && (
                                            <button onClick={(e) => { e.stopPropagation(); setEvidenceList(prev => prev.filter(i => i.id !== ev.id)); }} className="bg-red-500 text-white w-5 h-5 flex items-center justify-center text-xs absolute -top-2 -right-2 rounded-full">✕</button>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Official Evidence - Only in Review */}
                            {room.status === 'REVIEW' && (result?.officialEvidence || currentRound?.evidence)?.map((ev: any) => {
                                let box;
                                try { box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box; } catch (e) { return null; }
                                if (!box) return null;

                                // Check if user found this evidence
                                // result.evidenceFound is usually an array of IDs of OFFICIAL evidence found.
                                // Or check result.userEvidence? 
                                // Submit API saves "evidence_found" as list of IDs.
                                // round_result returns "evidenceFound" (parsed).
                                const isFound = result?.evidenceFound?.includes(ev.id); // result might differ structure, checking logic...
                                // In round_result.ts: evidenceFound = guess.evidence_found ? JSON.parse...
                                // Wait, round_result.ts didn't return "evidenceFound" explicitly in JSON!
                                // It returned `userEvidence` (which is room_evidence table) and `guesses`.
                                // Let's check api.room.$code.round_result.ts return structure again.
                                // Step 710: returns { guesses, userEvidence, officialEvidence ... }
                                // It does NOT return `evidenceFound` array explicitly, but `guesses` has `evidence_found` string.

                                let foundIds: string[] = [];
                                if (result?.guesses && result.guesses.length > 0) {
                                    try { foundIds = JSON.parse(result.guesses[0].evidence_found || "[]"); } catch (e) { }
                                } else if (result?.evidence_found) {
                                    // From existingGuess or direct result
                                    try { foundIds = typeof result.evidence_found === 'string' ? JSON.parse(result.evidence_found) : result.evidence_found; } catch (e) { }
                                }

                                const wasFound = foundIds.includes(ev.id);

                                return (
                                    <div key={ev.id} className={`absolute border-2 ${wasFound ? 'border-yellow-400 bg-yellow-400/10' : 'border-red-500 bg-red-500/10'} flex flex-col items-start p-1`}
                                        style={{ left: `${box.x / 10}%`, top: `${box.y / 10}%`, width: `${box.w / 10}%`, height: `${box.h / 10}%` }}
                                    >
                                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[9999] ${wasFound ? 'bg-yellow-500 text-black' : 'bg-red-600 text-white'} text-[9px] font-bold px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-wrap min-w-[150px] pointer-events-none`}>
                                            {ev.ai_analysis ? (
                                                <>
                                                    <span className={`block mb-1 ${wasFound ? 'text-black' : 'text-red-200'}`}>
                                                        {wasFound ? "✅ Verified Intel:" : "❌ Missed Intel:"}
                                                    </span>
                                                    {ev.ai_analysis}
                                                </>
                                            ) : ev.description}
                                        </div>
                                    </div>
                                );
                            })}
                        </EvidenceCanvas>
                    ) : <div className="flex items-center justify-center h-full">No Signal</div>}

                    {/* SYNCHRONIZED DRAWING LAYER */}
                    <canvas
                        ref={imageCanvasRef}
                        className="absolute inset-0 w-full h-full pointer-events-none z-40 mix-blend-screen"
                    />
                </div>
            </div>

            {/* COLUMN 2: MAP */}
            <div className={`transition-all duration-700 ease-in-out bg-slate-900 overflow-hidden relative border-r border-white/10 ${layoutMode === "result" ? "relative w-full md:w-[40%] h-full" : "relative w-full md:w-1/2 h-full"}`}>
                <div ref={mapRef} className="w-full h-full relative z-0" />

                {/* SYNCHRONIZED DRAWING LAYER */}
                <canvas
                    ref={mapCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none z-10 mix-blend-screen"
                />

                {
                    !submitted ? (
                        <>
                            {/* Vicinity Scan Button */}
                            {!submitted && isVicinityScanAvailable && !hasZoomed && (
                                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-20">
                                    {isTargetInRange ? (
                                        <div className="w-full py-3 bg-red-500/20 text-red-300 border border-red-500/50 backdrop-blur-md rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 animate-in fade-in transition-all">
                                            <span className="text-lg">📶</span>
                                            Signal Strong • Scan Disabled
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleVicinityScan}
                                            className="w-full py-3 bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-300 border border-yellow-500/50 backdrop-blur-md rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 animate-pulse"
                                        >
                                            <span className="text-lg">📡</span>
                                            Initiate Vicinity Scan
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xs px-4">
                                <button onClick={handleSubmit} disabled={!guess} className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all border border-white/10 backdrop-blur-xl ${guess ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-black/40 text-white/20'}`}>
                                    CONFIRM COORDINATES
                                </button>
                            </div>
                        </>
                    ) : (
                        room.status === 'PLAYING' && (
                            <div className="absolute bottom-6 left-6 right-6 z-10">
                                <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5">
                                    <div className="text-xs uppercase tracking-widest mb-1 text-emerald-300">Target Acquired</div>
                                    <div className="text-lg font-black">LOCKED IN</div>
                                    <div className="text-[10px] font-mono opacity-70 mt-1 uppercase">Awaiting Mission Control Reveal...</div>
                                </div>
                            </div>
                        )
                    )
                }
            </div >

            {/* Logout Button */}
            < div className="absolute top-4 left-4 z-50" >
                <Link to="/join" className="px-4 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 backdrop-blur-md rounded-lg text-red-400 text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 flex items-center gap-2">
                    <span>⚠</span> ABORT MISSION
                </Link>
            </div >

            {/* Evidence Reveal Modal (Syncs with Teacher) */}
            {
                currentRound?.focusedEvidenceId && (
                    (() => {
                        const allEvidence = [...(result?.officialEvidence || []), ...(currentRound?.evidence || [])];
                        const focusedItem = allEvidence.find((e: any) => e.id === currentRound.focusedEvidenceId);

                        // Fallback if we haven't fetched detailed evidence yet (unlikely in Review)
                        // But finding it in `currentRound.evidence` should work if status API returns it.
                        // Wait, status API returns `evidence` (official list) if status is REVIEW.
                        // If status is PLAYING, `evidence` is empty.
                        // But Teacher can only click evidence in Review mode (where canvas is interactive).
                        // So `currentRound.evidence` should be present.

                        if (!focusedItem) return null;

                        return (
                            <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
                                <div className="bg-slate-900 border-2 border-yellow-500 rounded-2xl max-w-2xl w-full p-8 shadow-2xl relative animate-in zoom-in-95 duration-300 flex flex-col md:flex-row gap-8">
                                    {/* Scanline Effect */}
                                    <div className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden opacity-20">
                                        <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.5)_50%)] bg-[length:100%_4px]" />
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1">
                                        <div className="text-yellow-400 text-xs font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                                            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                            Intel Revealed
                                        </div>
                                        <h2 className="text-2xl md:text-4xl font-black text-white mb-6 uppercase tracking-tighter leading-none">
                                            {focusedItem.description}
                                        </h2>

                                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                                            <h3 className="text-blue-300 text-[10px] font-bold uppercase tracking-widest mb-3">AI Analysis</h3>
                                            <p className="text-slate-300 text-sm md:text-base leading-relaxed font-medium">
                                                {focusedItem.ai_analysis || "No analysis data available."}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Minimap Loop? Or just decorative icon */}
                                    <div className="w-full md:w-1/3 flex items-center justify-center border border-white/10 rounded-xl bg-black/40 p-4">
                                        <div className="text-center">
                                            <div className="text-6xl mb-2">🔭</div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest">Visual Verified</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()
                )
            }

            {/* Hints Overlay */}
            {
                (result && layoutMode === "result") && (
                    <div className="w-full md:w-[20%] bg-slate-900 border-l border-white/10 overflow-y-auto">
                        {result.score !== undefined ? (
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
                                    {result.aiFeedback && result.aiFeedback.results && result.aiFeedback.results.length > 0 ? (
                                        result.aiFeedback.results.map((item: any, i: number) => (
                                            <div key={i} className="text-xs text-slate-300 border-l-2 border-blue-500/50 pl-3 py-1">
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-blue-400 block mb-1">Found: {item.description}</span>
                                                </div>
                                                <p className="opacity-80 leading-snug">{item.explanation}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-slate-500 italic mb-4">No anomalies detected by agent.</p>
                                    )}

                                    {/* Missed Evidence List */}
                                    {(result?.officialEvidence || currentRound?.evidence)?.filter((ev: any) => !result.evidenceFound?.includes(ev.id)).length > 0 && (
                                        <div className="mt-4 space-y-2">
                                            <h3 className="text-xs uppercase text-red-400 mb-2">Missed Intel</h3>
                                            {(result?.officialEvidence || currentRound?.evidence).filter((ev: any) => !result.evidenceFound?.includes(ev.id)).map((ev: any) => {
                                                // Look for a personalized Gemini explanation
                                                let personalizedExplanation = null;
                                                if (result.aiFeedback?.missed_evidence_explanations && Array.isArray(result.aiFeedback.missed_evidence_explanations)) {
                                                    const AIExplanation = result.aiFeedback.missed_evidence_explanations.find((m: any) => m.admin_id === ev.id);
                                                    if (AIExplanation && AIExplanation.explanation) {
                                                        personalizedExplanation = AIExplanation.explanation;
                                                    }
                                                }

                                                return (
                                                    <div key={ev.id} className="text-xs text-slate-400 border-l-2 border-red-500/30 pl-3 py-1">
                                                        <div className="flex justify-between">
                                                            <span className="font-bold text-red-300 block mb-1">{ev.description}</span>
                                                        </div>
                                                        {(personalizedExplanation || ev.ai_analysis) && (
                                                            <p className="opacity-70 leading-snug">{personalizedExplanation || ev.ai_analysis}</p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
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
                            <div className="p-6 text-center text-slate-500 italic">
                                {result.message || "Analysis Complete. Data Encrypted. Waiting for HQ Reveal..."}
                            </div>
                        )}
                    </div>
                )
            }
        </div >
    );
}
