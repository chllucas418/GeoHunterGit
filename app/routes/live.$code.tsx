import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import { requireUser } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import { useSound } from "~/lib/useSound";
import { HighPrecisionTimeAttackHUD } from "~/components/game/TimeAttackHUD";
import { ResultPanel } from "~/components/game/ResultPanel";
import { ActionBar } from "~/components/game/ActionBar";
import { GameMap } from "~/components/game/GameMap";
import { Compass } from "~/components/game/Compass";
import { PlayerHUD } from "~/components/game/PlayerHUD";
import { PowersGuide } from "~/components/game/PowersGuide";
import { getRoomByCode, getRoomParticipants, getRoomGuessRecord, getRoomGuessCount } from "~/models/room.server";
import { getDefaultSimulationLocation, getLocationById, getMapEvidenceByLocation, getMapSetItemsCount, getMapSetItemByIndex } from "~/models/location.server";
import type { BoxCoordinates } from "~/types/shared";

export async function loader({ request, params, context }: any) {
    const userId = await requireUser(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // 1. Get Room & Current Round to check for existing submission
    const room = await getRoomByCode(db, code);
    let existingGuess = null;

    if (room && room.status !== 'WAITING') {
        const item = await getMapSetItemByIndex(db, room.map_set_id, room.has_guided_playthrough && room.current_index > 0 ? room.current_index - 1 : room.current_index);

        if (item) {
            const guessRecord = await getRoomGuessRecord(db, code, item.location_id, userId);

            if (guessRecord) {
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
                    distance: guessRecord.distance,
                    distanceMeters: guessRecord.distance * 1000,
                    ai_feedback: aiFeedback,
                    evidence_found: guessRecord.evidence_found
                };
            }
        }
    }

    // 2. Build initial room state (mirrors api.room.$code.status logic)
    let initialRoomState = null;
    if (room) {
        const [participants, mapSetInfo] = await Promise.all([
            getRoomParticipants(db, code),
            room.map_set_id ? Promise.all([
                getMapSetItemsCount(db, room.map_set_id),
                getMapSetItemByIndex(db, room.map_set_id, room.has_guided_playthrough && room.current_index > 0 ? room.current_index - 1 : room.current_index)
            ]) : Promise.resolve([null, null])
        ]);
        const [totalCount, item2] = mapSetInfo;
        let currentRound = null;

        const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;

        if (isGuidedRound) {
            const defaultSim = await getDefaultSimulationLocation(db);
            if (defaultSim) {
                const [location, allEvidence] = await Promise.all([
                    getLocationById(db, defaultSim.id),
                    getMapEvidenceByLocation(db, defaultSim.id)
                ]);
                let evidence: any[] = [];
                if (room.status === 'REVIEW' || isGuidedRound) evidence = allEvidence || [];
                const evidenceCount = allEvidence?.length || 0;
                currentRound = {
                    index: room.current_index,
                    total: (totalCount || 0) + 1,
                    startTime: room.round_start_time,
                    location, evidence, evidenceCount,
                    focusedEvidenceId: room.focused_evidence_id,
                    submissionCount: 0,
                    timeLimit: room.time_limit || 120,
                    isGuidedRound: true
                };
            }
        } else if (item2) {
            const realItem = item2;
            if (realItem) {
                const targetLocationId = realItem.location_id;
                const [location, allEvidence, submissionCount] = await Promise.all([
                    getLocationById(db, targetLocationId),
                    getMapEvidenceByLocation(db, targetLocationId),
                    getRoomGuessCount(db, code, targetLocationId)
                ]);
                let evidence: any[] = [];
                if (room.status === 'REVIEW') evidence = allEvidence || [];
                const evidenceCount = allEvidence?.length || 0;
                const totalRounds = room.has_guided_playthrough ? (totalCount || 0) + 1 : (totalCount || 0);
                currentRound = {
                    index: room.current_index,
                    total: totalRounds,
                    startTime: room.round_start_time,
                    location, evidence, evidenceCount,
                    focusedEvidenceId: room.focused_evidence_id,
                    submissionCount: submissionCount,
                    timeLimit: room.time_limit || 120,
                    isGuidedRound: false
                };
            }
        }
        initialRoomState = { room, participants, currentRound };
    }

    return { code, userId, mapsApiKey: env.GOOGLE_MAPS_API_KEY, existingGuess, initialRoomState };
}

// Extracted HighPrecisionTimeAttackHUD to ~/components/game/TimeAttackHUD

export default function StudentLiveGame() {
    const { code, userId, mapsApiKey, existingGuess, initialRoomState } = useLoaderData() as any;
    const fetcher = useFetcher();
    const actionFetcher = useFetcher();

    const [roomState, setRoomState] = useState<any>(initialRoomState);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [guess, setGuess] = useState<{ lat: number, lng: number } | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [submittedAtSeconds, setSubmittedAtSeconds] = useState<number | null>(null);
    const [result, setResult] = useState<any>(null);
    const lastRoundIndex = useRef<number>(-1);
    const serverClockOffsetRef = useRef<number>(0);

    // --- NEW UI STATES ---
    const [evidenceList, setEvidenceList] = useState<{ box: BoxCoordinates; id: string }[]>([]);
    const [isEvidenceMode, setIsEvidenceMode] = useState(false);
    const [introStage, setIntroStage] = useState(0);
    const [secondsElapsed, setSecondsElapsed] = useState(0);
    const [visibleHints, setVisibleHints] = useState<string[]>([]);
    const [hasZoomed, setHasZoomed] = useState(false);
    const [splitRatio, setSplitRatio] = useState(50);
    const [isResizing, setIsResizing] = useState(false);
    const [hasAcknowledgedRules, setHasAcknowledgedRules] = useState(false);

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

    const isTimeUp = currentRound?.startTime ? ((currentRound.timeLimit || 120) - secondsElapsed <= 0) : false;
    const isLockedRef = useRef(false);
    isLockedRef.current = submitted || room?.status !== 'PLAYING' || isTimeUp;

    // --- POWER-UP STATES ---
    const me = roomState?.participants?.find((p: any) => p.user_id === userId);
    const myTeam = me?.team_id;
    const powerupEnergy = me?.powerup_energy || 0;
    const [isBlurred, setIsBlurred] = useState(false);
    const [activePowerups, setActivePowerups] = useState<string[]>([]);
    const [pointMultiplier, setPointMultiplier] = useState(1);

    const [spentEnergy, setSpentEnergy] = useState(0);
    const localEnergy = Math.max(0, powerupEnergy - spentEnergy);
    const [hasScoreMultiplier, setHasScoreMultiplier] = useState(false);
    const [showCompass, setShowCompass] = useState(false);

    // NEW PHASE 2 SUPERPOWER STATES
    const [isEmpBlackout, setIsEmpBlackout] = useState(false);
    const [isIntelCorrupted, setIsIntelCorrupted] = useState(false);
    const [isMapScrambled, setIsMapScrambled] = useState(false);
    const [isLeeched, setIsLeeched] = useState(false); // Victim
    const [hasMultiplierLeech, setHasMultiplierLeech] = useState(false); // Attacker
    const [hasAegis, setHasAegis] = useState(false);
    const [hasChronoFreeze, setHasChronoFreeze] = useState(false);
    const [hasIroncladLockdown, setHasIroncladLockdown] = useState(false);
    const [quantumCircle, setQuantumCircle] = useState<google.maps.Circle | null>(null);

    const [previewPowerId, setPreviewPowerId] = useState<string | null>(null);
    useEffect(() => {
        if (previewPowerId) {
            const t = setTimeout(() => setPreviewPowerId(null), 5000);
            return () => clearTimeout(t);
        }
    }, [previewPowerId]);

    // PowersGuide: show once per session on first mission with powers
    const [showPowersGuide, setShowPowersGuide] = useState(false);
    useEffect(() => {
        const hasSeenPowersGuide = sessionStorage.getItem("hasSeenPowersGuide");
        if (!hasSeenPowersGuide && availablePowers.offensive.length > 0) {
            setShowPowersGuide(true);
        }
    }, []);
    const dismissPowersGuide = () => {
        sessionStorage.setItem("hasSeenPowersGuide", "1");
        setShowPowersGuide(false);
    };

    const handlePowerTap = (id: string, cost: number, actionFn: Function) => {
        if (previewPowerId === id) {
            actionFn(id, cost);
            setPreviewPowerId(null);
        } else {
            setPreviewPowerId(id);
        }
    };

    // Extracted SUPERPOWER_DESCRIPTIONS to ~/components/game/ActionBar

    const hasAegisRef = useRef(hasAegis);
    useEffect(() => { hasAegisRef.current = hasAegis; }, [hasAegis]);

    const availablePowers = useMemo(() => {
        const off = ['gps_scrambler', 'intel_corruptor', 'emp_blackout', 'multiplier_leech'];
        const def = ['aegis_reflection', 'chrono_freeze', 'quantum_triangulation', 'ironclad_lockdown'];
        
        // Simple deterministic seed based on user + round index so it persists through React re-renders!
        const seedStr = `${userId}-${currentRound?.index || 0}`;
        let seed = 0;
        for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(31, seed) + seedStr.charCodeAt(i)) | 0;
        
        const random = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };
        
        const shuffle = (array: string[]) => {
            const arr = [...array];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        };

        return {
            offensive: shuffle(off).slice(0, 2),
            defensive: shuffle(def).slice(0, 2)
        };
    }, [userId, currentRound?.index]);

    // --- AUDIO HOOKS ---
    // Tiny base64 blips for quick audio feedback without needing external assets
    const TICK_SOUND = "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"; 
    const SUCCESS_SOUND = "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    
    const [playTick] = useSound(TICK_SOUND, { volume: 0.2 });
    const [playSuccess] = useSound(SUCCESS_SOUND, { volume: 0.5 });
    const [lastTickSecond, setLastTickSecond] = useState(-1);

    // Parse Metadata & Hints when location changes
    const hintList = location?.hints ? (typeof location.hints === 'string' ? (location.hints.startsWith('[') ? JSON.parse(location.hints) : location.hints.split('\n')) : location.hints) : [];

    let guidedBoxObj = null;
    if (currentRound?.isGuidedRound && tutorialStep === 2 && currentRound?.evidence?.[0]?.bounding_box) {
        try {
            guidedBoxObj = typeof currentRound.evidence[0].bounding_box === 'string' 
                ? JSON.parse(currentRound.evidence[0].bounding_box) 
                : currentRound.evidence[0].bounding_box;
        } catch (e) {
            console.error("Failed to parse guidedBox", e);
        }
    }

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
            
            // Temporary Powerup Reversals
            setActivePowerups([]);
            setHasScoreMultiplier(false);
            setPointMultiplier(1);
            setSpentEnergy(0);
            setShowCompass(false);
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

    // --- RESIZER LOGIC ---
    useEffect(() => {
        const saved = localStorage.getItem("geohunter-split-ratio");
        if (saved) setSplitRatio(parseFloat(saved));
    }, []);

    const handleResizeMove = (e: any) => {
        if (!isResizing) return;
        const newRatio = (e.clientX / window.innerWidth) * 100;
        setSplitRatio(Math.min(Math.max(newRatio, 20), 80));
    };

    const handleResizeEnd = () => {
        setIsResizing(false);
        localStorage.setItem("geohunter-split-ratio", splitRatio.toString());
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleResizeMove);
            window.addEventListener('mouseup', handleResizeEnd);
            window.addEventListener('touchmove', (e) => {
                const touch = e.touches[0];
                const newRatio = (touch.clientX / window.innerWidth) * 100;
                setSplitRatio(Math.min(Math.max(newRatio, 20), 80));
            });
            window.addEventListener('touchend', handleResizeEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleResizeMove);
            window.removeEventListener('mouseup', handleResizeEnd);
        };
    }, [isResizing]);

    // 1. Polling & Sync — uses plain fetch() for reliable state updates
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

                const newIndex = data.room?.current_index;

                // Detect Round Change for Animation
                if (lastRoundIndex.current !== newIndex) {
                    setIntroStage(0);
                    setTimeout(() => setIntroStage(1), 500);
                    setTimeout(() => setIntroStage(2), 3500);
                    setTimeout(() => setIntroStage(3), 4500);
                }

                // Detect Round Change — reset game state
                if (lastRoundIndex.current !== -1 && lastRoundIndex.current !== newIndex) {
                    setGuess(null);
                    setSubmitted(false);
                    setSubmittedAtSeconds(null);
                    setResult(null);
                    setEvidenceList([]);
                    setVisibleHints([]);
                    setHasZoomed(false);
                    setSpentEnergy(0);
                    setHasScoreMultiplier(false);
                    setShowCompass(false);
                    
                    setIsEmpBlackout(false);
                    setIsIntelCorrupted(false);
                    setIsMapScrambled(false);
                    setIsLeeched(false);
                    setHasMultiplierLeech(false);
                    setHasAegis(false);
                    setHasChronoFreeze(false);
                    setHasIroncladLockdown(false);
                    setQuantumCircle(prev => {
                        if (prev) prev.setMap(null);
                        return null;
                    });

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
                setRoomState(data);
            } catch (e) {
                console.error("Poll error:", e);
            }
        };

        poll();
        const interval = setInterval(poll, 3000);
        return () => { alive = false; clearInterval(interval); };
    }, [code]);

    // Timer Interval (Runs every 1s locally)
    useEffect(() => {
        const timer = setInterval(() => {
            if (roomState?.currentRound?.startTime) {
                const synchronizedNow = Date.now() - serverClockOffsetRef.current;
                const start = roomState.currentRound.startTime;
                const diff = Math.floor((synchronizedNow - start) / 1000);
                setSecondsElapsed(diff >= 0 ? diff : 0);

                // Play tick sound for last 10 seconds
                const timeRemaining = (roomState.currentRound.timeLimit || 120) - diff;
                if (timeRemaining <= 10 && timeRemaining > 0 && !submitted && room?.status === 'PLAYING') {
                    if (lastTickSecond !== timeRemaining) {
                        playTick();
                        setLastTickSecond(timeRemaining);
                    }
                }
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [roomState?.currentRound?.startTime, submitted, room?.status, lastTickSecond, playTick]);

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

    const lastMouseSend = useRef<number>(0);
    const handleMapMouseMove = (e: google.maps.MapMouseEvent) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!e.latLng) return;

        const now = Date.now();
        if (now - lastMouseSend.current < 100) return;
        lastMouseSend.current = now;

        wsRef.current.send(JSON.stringify({
            type: "cursor",
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
            userId: userId
        }));
    };

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
                                ctx.lineWidth = Math.max(2, targetCanvas.width * 0.005);
                                ctx.lineCap = 'round';
                                ctx.stroke();
                                ctx.closePath();

                                // Auto-fade drawings after 4 seconds of inactivity
                                clearTimeout((window as any).drawClearTimer);
                                (window as any).drawClearTimer = setTimeout(() => {
                                    [imageCanvasRef.current, mapCanvasRef.current].forEach(canvas => {
                                        if (canvas) {
                                            const ctx2 = canvas.getContext('2d');
                                            if (ctx2) ctx2.clearRect(0, 0, canvas.width, canvas.height);
                                        }
                                    });
                                }, 4000);
                            }
                        }
                    } else if (data.type === "draw_map" && mapInstance) {
                        let poly = (window as any).incomingMapPolys?.[data.polyId];
                        if (!poly) {
                            if (!(window as any).incomingMapPolys) {
                                (window as any).incomingMapPolys = {};
                            }
                            poly = new google.maps.Polyline({
                                strokeColor: "#ef4444",
                                strokeOpacity: 1.0,
                                strokeWeight: 4,
                                map: mapInstance
                            });
                            (window as any).incomingMapPolys[data.polyId] = poly;
                            
                            setTimeout(() => {
                                poly.setMap(null);
                                delete (window as any).incomingMapPolys[data.polyId];
                            }, 5000);
                        }
                        poly.setPath(data.path);
                    } else if (data.type === "draw_clear") {
                        [imageCanvasRef.current, mapCanvasRef.current].forEach(canvas => {
                            if (canvas) {
                                const ctx = canvas.getContext('2d');
                                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                            }
                        });
                        clearTimeout((window as any).drawClearTimer);
                    } else if (data.type === "pause_toggle") {
                        fetcher.load(`/api/room/${code}/status`);
                    } else if (data.type === "powerup") {
                        // REMOVE LEECH BROADCAST
                        if (data.effect === "remove_leech" && data.targetTeam !== myTeam) {
                            setIsLeeched(false);
                            setHasMultiplierLeech(false);
                            setActivePowerups(prev => prev.filter(p => !p.includes("Vampire") && !p.includes("Leech")));
                        } 
                        // INCOMING ATTACK
                        else if (data.targetTeam !== myTeam && !data.isReflectedTo) {
                            if (hasAegisRef.current) {
                                // DEFLECT IT!
                                setHasAegis(false);
                                setSpentEnergy(prev => Math.max(0, prev - 250)); // +250 energy bonus!
                                setActivePowerups(prev => [...prev.filter(p => !p.includes("Aegis")), "🛡️ Aegis Activated! Deflected Attack"]);
                                
                                wsRef.current?.send(JSON.stringify({
                                    type: "powerup", 
                                    effect: data.effect, 
                                    targetTeam: myTeam, // We are the new source
                                    isReflectedTo: data.targetTeam // The original sender
                                }));
                                return; // Nullify attack locally
                            }

                            // I am hit!
                            if (data.effect === "emp_blackout") {
                                setIsEmpBlackout(true);
                                setActivePowerups(prev => [...prev, "⚡ Sabotage: EMP Blackout!"]);
                                setTimeout(() => { setIsEmpBlackout(false); setActivePowerups(prev => prev.filter(p => !p.includes("EMP"))); }, 8000);
                            } else if (data.effect === "intel_corruptor") {
                                setIsIntelCorrupted(true);
                                setActivePowerups(prev => [...prev, "👾 Sabotage: Intel Corrupted!"]);
                                setTimeout(() => { setIsIntelCorrupted(false); setActivePowerups(prev => prev.filter(p => !p.includes("Intel"))); }, 10000);
                            } else if (data.effect === "multiplier_leech") {
                                setIsLeeched(true);
                                setActivePowerups(prev => [...prev, "🧛 Sabotage: The Vampire!"]);
                                setTimeout(() => { setIsLeeched(false); setActivePowerups(prev => prev.filter(p => !p.includes("Vampire"))); }, 10000);
                            } else if (data.effect === "gps_scrambler") {
                                setIsMapScrambled(true);
                                setActivePowerups(prev => [...prev, "🗺️ Sabotage: Map Scrambled!"]);
                                setTimeout(() => { setIsMapScrambled(false); setActivePowerups(prev => prev.filter(p => !p.includes("Map"))); }, 10000);
                            }
                        } 
                        // I GOT HIT BY MY OWN REFLECTED ATTACK
                        else if (data.isReflectedTo === myTeam) {
                            if (data.effect === "emp_blackout") {
                                setIsEmpBlackout(true);
                                setActivePowerups(prev => [...prev, "⚡ Reflected EMP Blackout"]);
                                setTimeout(() => { setIsEmpBlackout(false); setActivePowerups(prev => prev.filter(p => !p.includes("EMP"))); }, 8000);
                            } else if (data.effect === "intel_corruptor") {
                                setIsIntelCorrupted(true);
                                setActivePowerups(prev => [...prev, "👾 Reflected Intel Corrupt"]);
                                setTimeout(() => { setIsIntelCorrupted(false); setActivePowerups(prev => prev.filter(p => !p.includes("Intel"))); }, 10000);
                            } else if (data.effect === "multiplier_leech") {
                                setIsLeeched(true);
                                setActivePowerups(prev => [...prev, "🧛 Reflected Vampire Leech"]);
                                setTimeout(() => { setIsLeeched(false); setActivePowerups(prev => prev.filter(p => !p.includes("Vampire"))); }, 10000);
                            } else if (data.effect === "gps_scrambler") {
                                setIsMapScrambled(true);
                                setActivePowerups(prev => [...prev, "🗺️ Reflected Map Scramble"]);
                                setTimeout(() => { setIsMapScrambled(false); setActivePowerups(prev => prev.filter(p => !p.includes("Map"))); }, 10000);
                            }
                        }
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

    // 2. Map Initialization & Pre-loading
    useEffect(() => {
        setOptions({ key: mapsApiKey });
        // Pre-load libraries immediately on mount
        importLibrary("maps");
        importLibrary("marker");
    }, [mapsApiKey]);

    useEffect(() => {
        if (room?.status === 'PLAYING' && !mapInstance && mapRef.current) {
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
                    if (isLockedRef.current) return;
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
                map.addListener("mousemove", handleMapMouseMove);

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
    const isVicinityScanAvailable = secondsElapsed >= Math.max(0, (currentRound?.timeLimit || 120) - 30);

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
        if (!currentCenter) return;
        
        // Distance check from pin or map center to prevent spoiling if they are already super close
        const originLat = guess ? guess.lat : currentCenter.lat();
        const originLng = guess ? guess.lng : currentCenter.lng();
        const originName = guess ? "your dropped pin" : "your screen's map center";

        const dLat = location.lat - originLat;
        const dLng = location.lng - originLng;
        
        const R = 6371; // km
        const dLatRad = dLat * (Math.PI / 180);
        const dLngRad = dLng * (Math.PI / 180);
        const a = Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) +
                  Math.cos(originLat * (Math.PI / 180)) * Math.cos(location.lat * (Math.PI / 180)) *
                  Math.sin(dLngRad / 2) * Math.sin(dLngRad / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;

        if (distanceKm < 0.2) {
            alert(`SAT-NAV: Target signal strong in current sector. It is very close to ${originName}!`);
            return;
        }

        // Visual Mechanic: Pan to an approx 1km bounding box containing the exact target, 
        // with the target randomly offset from the center (so it's not exactly in the middle).
        const offsetLat = (Math.random() - 0.5) * 0.012; // +/- ~1.3km
        const offsetLng = (Math.random() - 0.5) * 0.012;
        
        const bounds = new google.maps.LatLngBounds();
        // Create an approximate 1km radius bounding box around the offset center
        bounds.extend({ lat: location.lat + offsetLat - 0.009, lng: location.lng + offsetLng - 0.009 });
        bounds.extend({ lat: location.lat + offsetLat + 0.009, lng: location.lng + offsetLng + 0.009 });
        // Ensure the actual target is in bounds just in case offset is too large
        bounds.extend({ lat: location.lat, lng: location.lng });
        
        mapInstance.fitBounds(bounds);

        setHasZoomed(true); // Disable further scans intuitively
        setVisibleHints(prev => [...prev, `📡 Vicinity Scan Active: Target is located somewhere within your current map view bounds.`]);
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

    const activatePower = (effect: string, cost: number) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
            type: "powerup", effect, targetTeam: myTeam, from: userId
        }));
        setSpentEnergy(prev => prev + cost);

        if (effect === 'multiplier_leech') {
            setHasMultiplierLeech(true);
            setActivePowerups(prev => [...prev, "🧛 Vitality Leech Active! Stealing Multiplier..."]);
            setTimeout(() => {
                setHasMultiplierLeech(false);
                setActivePowerups(prev => prev.filter(p => !p.includes("Vampire") && !p.includes("Leech")));
            }, 10000);
        }
    };

    const activateSelfBuff = (buff: string, cost: number) => {
        if (buff === 'aegis_reflection') {
            setHasAegis(true);
            setActivePowerups(prev => [...prev, "🛡️ Aegis Reflection Active"]);
        } else if (buff === 'chrono_freeze') {
            setHasChronoFreeze(true);
            setActivePowerups(prev => [...prev, "❄️ Chrono Freeze Active (15s)"]);
            setTimeout(() => {
                setHasChronoFreeze(false);
                setActivePowerups(prev => prev.filter(p => !p.includes("Chrono Freeze")));
            }, 15000);
        } else if (buff === 'quantum_triangulation') {
            if (mapInstance && location?.lat && location?.lng) {
                // Generate a random center within 300m so the target is inside the 500m circle
                const r = 300 / 111300; 
                const dx = (Math.random() - 0.5) * r;
                const dy = (Math.random() - 0.5) * r;
                const customCenter = { lat: location.lat + dy, lng: location.lng + dx };
                
                const circle = new google.maps.Circle({
                    strokeColor: "#10b981",
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    fillColor: "#10b981",
                    fillOpacity: 0.15,
                    map: mapInstance,
                    center: customCenter,
                    radius: 500, // User requested exactly 500m radius
                });
                setQuantumCircle(circle);
                mapInstance.panTo(customCenter);
                mapInstance.setZoom(14);
                setActivePowerups(prev => [...prev, "🎯 Quantum Triangulation Deployed"]);
            }
        } else if (buff === 'ironclad_lockdown') {
            setHasIroncladLockdown(true);
            setActivePowerups(prev => [...prev, "🔒 Ironclad Lockdown: Multiplier Saved"]);
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "powerup", effect: "remove_leech", targetTeam: myTeam, from: userId }));
            }
        }
        setSpentEnergy(prev => prev + cost);
    };

    const handleBoxDrawn = (box: BoxCoordinates | null) => {
        if (box) {
            setEvidenceList(prev => [...prev, { box, id: Math.random().toString(36).substr(2, 9) }]);
        }
    };

    const handleSubmit = () => {
        if (!guess) return;
        setSubmitted(true);
        setSubmittedAtSeconds(secondsElapsed);
        playSuccess(); // Audio feedback

        // Capture the exact floating point fraction of time they locked in at to guarantee perfect UI sync
        let exactElapsedSeconds = currentRound?.startTime ? Math.max(0, (Date.now() - serverClockOffsetRef.current - currentRound.startTime) / 1000) : secondsElapsed;
        
        // If Chrono Freeze is active, the submit time is officially locked at whichever is smaller (15s minimum penalty or whatever it was when they froze)
        // Since we don't have the exact frozen timestamp globally without refactoring, we rely on the server validation or pass a localized flag.
        
        const formData = new FormData();
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        formData.append("submittedAtSeconds", exactElapsedSeconds.toString());
        
        if (evidenceList.length > 0) {
            formData.append("evidenceList", JSON.stringify(evidenceList));
        }
        if (hasScoreMultiplier) formData.append("scoreMultiplier", "true");
        if (isLeeched) formData.append("isLeeched", "true");
        if (hasMultiplierLeech) formData.append("hasMultiplierLeech", "true");
        if (hasChronoFreeze) formData.append("hasChronoFreeze", "true"); // Server will parse this and calculate
        if (hasIroncladLockdown) formData.append("hasIroncladLockdown", "true");

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

    // Draw Official Pin & Line IMMEDIATELY once received (anti-cheat wait time bypassed)
    useEffect(() => {
        if (result?.officialLocation && mapInstance) {
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
    if (!room) return <div className="p-8 text-white text-center">Locating Mission Signal...</div>;

    if (room.status === 'WAITING') {
        return (
            <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-in fade-in pb-[env(safe-area-inset-bottom)]">
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
        <div className={`h-[100dvh] w-screen relative overflow-hidden bg-black text-white flex flex-col md:flex-row shadow-2xl pb-[env(safe-area-inset-bottom)] transition-none`}>

            {/* RADAR JAMMER: TV STATIC OVERLAY */}
            {isBlurred && (
                <div className="absolute inset-0 z-[9997] pointer-events-auto cursor-not-allowed" style={{ isolation: 'isolate' }}>
                    {/* Animated noise layer */}
                    <div className="absolute inset-0" style={{
                        background: `repeating-linear-gradient(
                            0deg,
                            transparent,
                            transparent 2px,
                            rgba(0,0,0,0.3) 2px,
                            rgba(0,0,0,0.3) 4px
                        )`,
                        animation: 'staticScroll 0.1s steps(4) infinite',
                    }} />
                    {/* Noise grain */}
                    <div className="absolute inset-0 opacity-80" style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E")`,
                        backgroundSize: '128px 128px',
                        animation: 'staticGrain 0.05s steps(8) infinite',
                        mixBlendMode: 'overlay',
                    }} />
                    {/* Color aberration flicker */}
                    <div className="absolute inset-0" style={{
                        background: 'linear-gradient(180deg, rgba(255,0,0,0.03) 33%, rgba(0,255,0,0.03) 33%, rgba(0,255,0,0.03) 66%, rgba(0,0,255,0.03) 66%)',
                        backgroundSize: '100% 3px',
                        animation: 'staticFlicker 0.15s steps(3) infinite',
                    }} />
                    {/* Central warning text */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center" style={{ animation: 'staticGlitch 0.3s steps(2) infinite' }}>
                            <div className="text-6xl md:text-8xl font-black text-red-500 uppercase tracking-tighter mb-2" style={{ textShadow: '3px 0 #0ff, -3px 0 #f0f' }}>JAMMED</div>
                            <div className="text-sm font-mono text-white/60 tracking-[0.5em] uppercase">Signal Compromised</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Radar Jammer CSS Animations */}
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes staticScroll {
                    0% { transform: translateY(0); }
                    100% { transform: translateY(8px); }
                }
                @keyframes staticGrain {
                    0%, 100% { transform: translate(0, 0); }
                    10% { transform: translate(-2%, -3%); }
                    20% { transform: translate(3%, 1%); }
                    30% { transform: translate(-1%, 2%); }
                    40% { transform: translate(2%, -1%); }
                    50% { transform: translate(-3%, 3%); }
                    60% { transform: translate(1%, -2%); }
                    70% { transform: translate(-2%, 1%); }
                    80% { transform: translate(3%, -3%); }
                    90% { transform: translate(-1%, 2%); }
                }
                @keyframes staticFlicker {
                    0% { opacity: 0.8; }
                    50% { opacity: 0.4; }
                    100% { opacity: 0.9; }
                }
                @keyframes staticGlitch {
                    0% { transform: translate(0, 0) skewX(0deg); }
                    25% { transform: translate(-2px, 1px) skewX(-1deg); }
                    50% { transform: translate(2px, -1px) skewX(1deg); }
                    75% { transform: translate(-1px, 2px) skewX(0.5deg); }
                    100% { transform: translate(0, 0) skewX(0deg); }
                }
                @keyframes compassSweep {
                    0% { transform: rotate(0deg); opacity: 0.6; }
                    100% { transform: rotate(360deg); opacity: 0.6; }
                }
                @keyframes compassPulse {
                    0%, 100% { box-shadow: 0 0 15px rgba(52, 211, 153, 0.4), inset 0 0 15px rgba(52, 211, 153, 0.1); }
                    50% { box-shadow: 0 0 30px rgba(52, 211, 153, 0.8), inset 0 0 30px rgba(52, 211, 153, 0.2); }
                }
            ` }} />

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

            {/* ACTIVE POWERUP ALERTS */}
            {activePowerups.length > 0 && (
                <div className="absolute top-32 inset-x-0 z-[9998] flex flex-col items-center pointer-events-none gap-2">
                    {activePowerups.map((msg, i) => (
                        <div key={i} className="bg-red-600/90 text-white px-6 py-2 rounded-full font-black uppercase tracking-widest shadow-[0_0_20px_rgba(220,38,38,0.8)] animate-bounce border-2 border-red-400">
                            ⚠️ {msg} ⚠️
                        </div>
                    ))}
                </div>
            )}

            {/* COLUMN 1: EVIDENCE / IMAGE */}
            <div
                className={`relative h-full md:h-full transition-all duration-700 ease-in-out border-r border-white/10 overflow-hidden
                    ${layoutMode === "result" ? "w-full md:w-[40%]" : "w-full"}`}
                style={layoutMode !== "result" ? { flexBasis: `${splitRatio}%` } : {}}
            >
                {/* PLAYER HUD OVERLAYS */}
                <PlayerHUD 
                    room={room} 
                    currentRound={currentRound} 
                    secondsElapsed={secondsElapsed} 
                    hintList={hintList} 
                    introStage={introStage} 
                    location={location}
                    hasAcknowledgedRules={hasAcknowledgedRules} 
                    setHasAcknowledgedRules={setHasAcknowledgedRules} 
                    tutorialStep={tutorialStep} 
                    setTutorialStep={setTutorialStep}
                    evidenceList={evidenceList} 
                    guess={guess} 
                    submitted={submitted} 
                    visibleHints={visibleHints} 
                    isIntelCorrupted={isIntelCorrupted}
                    isEvidenceMode={isEvidenceMode} 
                    setIsEvidenceMode={setIsEvidenceMode}
                />

                {/* Tutorial Column 1 Blur Overlay */}
                {!submitted && currentRound?.isGuidedRound && (tutorialStep === 1 || tutorialStep === 3 || tutorialStep === 4) && (
                    <div className="absolute inset-0 z-[65] bg-black/60 backdrop-blur-md transition-all duration-500" />
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
                            guidedBox={guidedBoxObj}
                        >
                            {/* User Evidence */}
                            {evidenceList.map((ev, index) => {
                                // Review phase color coding using AI feedback:
                                // Yellow = student choice (base)
                                // Green = Valid match
                                // Red = Invalid match (attempted but wrong)
                                // Blue = No match / Novel discovery
                                let borderColorClass = "border-transparent";
                                let bgColorClass = "bg-transparent";

                                if (room.status === 'REVIEW') {
                                    const aiResults = result?.aiFeedback?.results || [];
                                    const aiResult = aiResults.find((r: any) => r.index === index);
                                    
                                    if (aiResult) {
                                        const hasMatch = typeof aiResult.matched_admin_index === 'number' && aiResult.matched_admin_index >= 0;
                                        if (hasMatch) {
                                            if (aiResult.validity >= 0.7) {
                                                borderColorClass = "border-green-400";
                                                bgColorClass = "bg-green-400/30";
                                            } else {
                                                borderColorClass = "border-red-500";
                                                bgColorClass = "bg-red-500/30";
                                            }
                                        } else {
                                            // Novel Discovery or Generic
                                            borderColorClass = "border-blue-500";
                                            bgColorClass = "bg-blue-500/30";
                                        }
                                    } else {
                                        // Fallback to spatial check if AI result missing for this index
                                        const officialList = result?.officialEvidence || currentRound?.evidence || [];
                                        const studentBox = ev.box;
                                        const overlapsOfficial = officialList.some((oe: any) => {
                                            let oBox;
                                            try { oBox = typeof oe.bounding_box === 'string' ? JSON.parse(oe.bounding_box) : oe.bounding_box; } catch { return false; }
                                            if (!oBox) return false;
                                            const ax1 = studentBox.x, ay1 = studentBox.y, ax2 = studentBox.x + studentBox.w, ay2 = studentBox.y + studentBox.h;
                                            const bx1 = oBox.x, by1 = oBox.y, bx2 = oBox.x + oBox.w, by2 = oBox.y + oBox.h;
                                            const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
                                            const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
                                            const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
                                            const intersection = iw * ih;
                                            const areaB = oBox.w * oBox.h;
                                            return (intersection / areaB) >= 0.3;
                                        });

                                        if (overlapsOfficial) {
                                            borderColorClass = "border-green-400";
                                            bgColorClass = "bg-green-400/20";
                                        } else {
                                            borderColorClass = "border-blue-500";
                                            bgColorClass = "bg-blue-500/20";
                                        }
                                    }
                                }

                                return (
                                    <div key={ev.id} className="absolute transition-all duration-500"
                                        style={{ left: `${ev.box.x / 10}%`, top: `${ev.box.y / 10}%`, width: `${ev.box.w / 10}%`, height: `${ev.box.h / 10}%` }}
                                    >
                                        {/* BASE YELLOW BOX (Student's choice) */}
                                        <div className="absolute inset-0 border-2 border-yellow-400/50 bg-yellow-400/10" />
                                        
                                        {/* OVERLAP RESULT BOX */}
                                        <div className={`absolute inset-0 border-2 ${borderColorClass} ${bgColorClass} transition-colors duration-700`} />

                                        {!submitted && (
                                            <button onClick={(e) => { e.stopPropagation(); setEvidenceList(prev => prev.filter(i => i.id !== ev.id)); }} className="bg-red-500 text-white w-5 h-5 flex items-center justify-center text-xs absolute -top-2 -right-2 rounded-full z-[100]">✕</button>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Official Evidence - Only in Review (Shows found/not found) */}
                            {room.status === 'REVIEW' && (result?.officialEvidence || currentRound?.evidence)?.map((ev: any) => {
                                let box;
                                try { box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box; } catch (e) { return null; }
                                if (!box) return null;

                                const wasFound = evidenceList.some((userEv, uIdx) => {
                                    const aiResult = result?.aiFeedback?.results?.find((r: any) => r.index === uIdx);
                                    if (aiResult && aiResult.matched_admin_index !== -1) {
                                        // Use AI matching if available
                                        const officialEvidenceList = result?.officialEvidence || currentRound?.evidence || [];
                                        return officialEvidenceList[aiResult.matched_admin_index]?.id === ev.id && aiResult.validity >= 0.7;
                                    }
                                    // Spatial fallback
                                    const sBox = userEv.box;
                                    const ax1 = sBox.x, ay1 = sBox.y, ax2 = sBox.x + sBox.w, ay2 = sBox.y + sBox.h;
                                    const bx1 = box.x, by1 = box.y, bx2 = box.x + box.w, by2 = box.y + box.h;
                                    const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
                                    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
                                    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
                                    const intersection = iw * ih;
                                    const areaB = box.w * box.h;
                                    return (intersection / areaB) >= 0.3;
                                });

                                return (
                                    <div key={ev.id} className={`absolute border-2 border-dashed ${wasFound ? 'border-green-400/40 bg-green-400/5' : 'border-red-500/40 bg-red-500/5'} flex flex-col items-start p-1 pointer-events-none`}
                                        style={{ left: `${box.x / 10}%`, top: `${box.y / 10}%`, width: `${box.w / 10}%`, height: `${box.h / 10}%` }}
                                    >
                                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[9999] ${wasFound ? 'bg-green-600' : 'bg-red-600'} text-white text-[9px] font-bold px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-wrap min-w-[150px]`}>
                                            {ev.ai_analysis && ev.ai_analysis !== "Real-time analysis active." ? (
                                                <>
                                                    <span className={`block mb-1 ${wasFound ? 'text-green-200' : 'text-red-200'}`}>
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

            {/* DRAGGABLE DIVIDER */}
            {layoutMode !== "result" && (
                <div
                    onMouseDown={() => setIsResizing(true)}
                    onTouchStart={() => setIsResizing(true)}
                    className="hidden md:flex w-2 hover:w-4 group bg-black/40 hover:bg-blue-500/50 cursor-col-resize items-center justify-center transition-all z-[80] relative border-x border-white/10"
                >
                    <div className="w-0.5 h-12 bg-white/20 group-hover:bg-white/60 rounded-full" />
                </div>
            )}

            {/* COLUMN 2: MAP */}
            <GameMap
                layoutMode={layoutMode}
                isMapScrambled={isMapScrambled}
                splitRatio={splitRatio}
                mapRef={mapRef}
                mapCanvasRef={mapCanvasRef}
                submitted={submitted}
                isTimeUp={isTimeUp}
                currentRound={currentRound}
                tutorialStep={tutorialStep}
                isVicinityScanAvailable={isVicinityScanAvailable}
                hasZoomed={hasZoomed}
                isTargetInRange={isTargetInRange}
                handleVicinityScan={handleVicinityScan}
                room={room}
                serverClockOffsetRef={serverClockOffsetRef}
                submittedAtSeconds={submittedAtSeconds}
                result={result}
                hasScoreMultiplier={hasScoreMultiplier}
                guess={guess}
                handleSubmit={handleSubmit}
                actionFetcher={actionFetcher}
            />

            {/* ACTION BAR (Bottom Center Global) */}
            <ActionBar
                room={room}
                submitted={submitted}
                previewPowerId={previewPowerId}
                localEnergy={localEnergy}
                availablePowers={availablePowers}
                hasAegis={hasAegis}
                hasChronoFreeze={hasChronoFreeze}
                quantumCircle={quantumCircle}
                hasIroncladLockdown={hasIroncladLockdown}
                handlePowerTap={handlePowerTap}
                activatePower={activatePower}
                activateSelfBuff={activateSelfBuff}
            />

            {/* POWERS GUIDE — shown once on first mission with abilities */}
            {showPowersGuide && (
                <PowersGuide
                    availablePowers={availablePowers}
                    onDismiss={dismissPowersGuide}
                />
            )}

            {/* COMPASS RADAR UI */}
            <Compass showCompass={showCompass} location={location} mapInstance={mapInstance} />

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
                                                {focusedItem.ai_analysis && focusedItem.ai_analysis !== "Real-time analysis active." ? focusedItem.ai_analysis : "No analysis data available."}
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
            <ResultPanel result={result} layoutMode={layoutMode} room={room} currentRound={currentRound} evidenceList={evidenceList} />

            {isEmpBlackout && (
                <div className="fixed inset-0 z-[9999] bg-black bg-opacity-95 pointer-events-none flex flex-col items-center justify-center animate-pulse backdrop-blur-3xl">
                    <div className="text-red-500 font-mono text-4xl md:text-6xl font-black mb-2 animate-bounce uppercase tracking-tighter drop-shadow-[0_0_20px_rgba(239,68,68,0.8)]">⚡ SYSTEM FAILURE ⚡</div>
                    <div className="text-red-400 font-mono text-xl md:text-2xl tracking-widest text-center uppercase">Critical EMP Overload Detected</div>
                    <div className="text-red-500/50 text-[10px] uppercase font-bold tracking-[0.5em] mt-8 opacity-50">NO SIGNAL DETECTED</div>
                </div>
            )}
        </div >
    );
}
