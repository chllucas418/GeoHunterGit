import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireTeacher } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

export async function loader({ request, params, context }: any) {
    await requireTeacher(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();

    let currentItem = null;
    let location = null;
    if (room && room.map_set_id) {
        const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;

        if (isGuidedRound) {
            let defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
            if (!defaultSim) {
                defaultSim = await db.prepare("SELECT id FROM locations ORDER BY created_at ASC LIMIT 1").first<any>();
            }
            if (defaultSim) {
                location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(defaultSim.id).first<any>();
            }
        } else {
            const datasetIndex = room.has_guided_playthrough ? room.current_index - 1 : room.current_index;
            currentItem = await db.prepare(
                "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
            ).bind(room.map_set_id, datasetIndex).first<any>();

            if (currentItem) {
                location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(currentItem.location_id).first<any>();
            }
        }
    }

    return { code, room, location, mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export default function TeacherControlPanel() {
    const { code, location, mapsApiKey } = useLoaderData() as any;
    const fetcher = useFetcher();
    const revalidator = useRevalidator();

    // Auto-Update Panel Polling
    useEffect(() => {
        const interval = setInterval(() => {
            if (revalidator.state === "idle") {
                revalidator.revalidate();
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [revalidator]);

    const [ws, setWs] = useState<WebSocket | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const wsReconnectAttemptRef = useRef(0);
    const [wsStatus, setWsStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const laserMarkerRef = useRef<google.maps.Marker | null>(null);
    const targetMarkerRef = useRef<google.maps.Marker | null>(null);
    const cursorsRef = useRef<Record<string, google.maps.Marker>>({});
    const [drawMode, setDrawMode] = useState(false);
    const drawModeRef = useRef(false);
    useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
    const activePolylinesRef = useRef<google.maps.Polyline[]>([]);
    const currentPathRef = useRef<{lat: number, lng: number}[]>([]);

    // Setup WebSocket
    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/room/${code}/ws`;

        let socket: WebSocket;
        let reconnectTimer: NodeJS.Timeout;

        const connect = () => {
            if (typeof WebSocket === "undefined") return;
            socket = new WebSocket(wsUrl);
            socket.onopen = () => {
                setWsStatus('connected');
                wsReconnectAttemptRef.current = 0;
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "cursor" && mapInstance) {
                        let marker = cursorsRef.current[data.id];
                        if (!marker) {
                            marker = new google.maps.Marker({
                                position: { lat: data.lat, lng: data.lng },
                                map: mapInstance,
                                icon: {
                                    path: google.maps.SymbolPath.CIRCLE,
                                    scale: 3,
                                    fillColor: "#3b82f6",
                                    fillOpacity: 0.6,
                                    strokeColor: "#ffffff",
                                    strokeWeight: 1,
                                },
                            });
                            cursorsRef.current[data.id] = marker;
                        } else {
                            marker.setPosition({ lat: data.lat, lng: data.lng });
                        }
                    }
                } catch (e) { }
            };

            socket.onclose = () => {
                setWsStatus('reconnecting');
                // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
                const delay = Math.min(1000 * Math.pow(2, wsReconnectAttemptRef.current), 30000);
                wsReconnectAttemptRef.current++;
                reconnectTimer = setTimeout(connect, delay);
            };

            setWs(socket);
            wsRef.current = socket;
        };

        connect();

        return () => {
            clearTimeout(reconnectTimer);
            if (socket) socket.close();
        };
    }, [code, mapInstance]);

    // Setup Map
    useEffect(() => {
        if (!mapInstance && mapRef.current) {
            setOptions({ key: mapsApiKey });
            importLibrary("maps").then(async () => {
                const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;

                // Set center to Current Location or default Tuen Mun
                const centerNode = location ? { lat: location.lat, lng: location.lng } : { lat: 22.3964, lng: 113.9725 };

                const map = new Map(mapRef.current!, {
                    center: centerNode,
                    zoom: 14,
                    disableDefaultUI: true,
                    mapTypeId: "hybrid",
                    gestureHandling: "greedy",
                });

                if (location) {
                    targetMarkerRef.current = new google.maps.Marker({
                        position: centerNode,
                        map: map,
                        title: "Official Target",
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: "#ef4444", // Red for target
                            fillOpacity: 1,
                            strokeWeight: 2,
                            strokeColor: "#ffffff",
                        }
                    });
                }

                // --- MAP DRAWING LOGIC ---
                let isDrawingOnMap = false;
                let drawTimeoutId: NodeJS.Timeout | null = null;
                
                map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
                    if (!drawModeRef.current || !e.latLng) return;
                    
                    const startPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                    
                    drawTimeoutId = setTimeout(() => {
                        isDrawingOnMap = true;
                        map.setOptions({ draggable: false, gestureHandling: 'none' });

                        const newPoly = new google.maps.Polyline({
                            strokeColor: "#ef4444",
                            strokeOpacity: 1.0,
                            strokeWeight: 4,
                            map: map
                        });
                        activePolylinesRef.current.push(newPoly);
                        currentPathRef.current = [startPos];
                        newPoly.setPath(currentPathRef.current);
                    }, 250); // 250ms long press
                });

                map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
                    if (!drawModeRef.current || !e.latLng) return;
                    if (!isDrawingOnMap) {
                        // Cancel long press if the user just clicked and dragged immediately
                        if (drawTimeoutId) {
                            clearTimeout(drawTimeoutId);
                            drawTimeoutId = null;
                        }
                        return;
                    }
                    
                    currentPathRef.current.push({ lat: e.latLng.lat(), lng: e.latLng.lng() });
                    
                    const currentPoly = activePolylinesRef.current[activePolylinesRef.current.length - 1];
                    currentPoly.setPath(currentPathRef.current);

                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            type: "draw_map",
                            path: currentPathRef.current,
                            polyId: activePolylinesRef.current.length
                        }));
                    }
                });

                map.addListener("mouseup", () => {
                    if (drawTimeoutId) {
                        clearTimeout(drawTimeoutId);
                        drawTimeoutId = null;
                    }
                    if (!drawModeRef.current) return;
                    
                    if (isDrawingOnMap) {
                        isDrawingOnMap = false;
                        map.setOptions({ draggable: true, gestureHandling: 'greedy' }); // FIxed map stalling here
                        
                        const poly = activePolylinesRef.current[activePolylinesRef.current.length - 1];
                        setTimeout(() => {
                            if (poly) poly.setMap(null);
                        }, 4000);
                    }
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (drawModeRef.current) return;
                    const lat = e.latLng!.lat();
                    const lng = e.latLng!.lng();

                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "laser", lat, lng }));
                    }

                    if (laserMarkerRef.current) {
                        laserMarkerRef.current.setPosition({ lat, lng });
                    } else {
                        laserMarkerRef.current = new google.maps.Marker({
                            position: { lat, lng },
                            map: map,
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 10,
                                fillColor: "#ef4444",
                                fillOpacity: 1,
                                strokeColor: "#ffffff",
                                strokeWeight: 2,
                            }
                        });
                    }

                    setTimeout(() => {
                        if (laserMarkerRef.current) {
                            laserMarkerRef.current.setMap(null);
                            laserMarkerRef.current = null;
                        }
                    }, 2000);
                });

                setMapInstance(map);
            });
        }
    }, [mapsApiKey, mapInstance, ws]);

    // Recenter map and update target marker when location changes via polling
    useEffect(() => {
        if (mapInstance && location) {
            const newCenter = { lat: location.lat, lng: location.lng };
            mapInstance.setCenter(newCenter);
            if (targetMarkerRef.current) {
                targetMarkerRef.current.setPosition(newCenter);
            }
        }
    }, [location, mapInstance]);

    const togglePause = async () => {
        // Optimistic WS Broadcast
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "pause_toggle" }));
        }

        // Mutate Database State so late-joiners get proper status
        try {
            await fetch(`/api/room/${code}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=TOGGLE_PAUSE'
            });
        } catch (e) {
            console.error('Freeze ray error:', e);
        }
    };

    // --- IMAGE DRAWING LOGIC ---
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const lastPosRef = useRef<{ x: number, y: number } | null>(null);
    const inkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    };

    const drawLine = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, height: number) => {
        ctx.beginPath();
        ctx.moveTo(x0 * width, y0 * height);
        ctx.lineTo(x1 * width, y1 * height);
        ctx.strokeStyle = '#ef4444'; // Red pen
        ctx.lineWidth = Math.max(2, width * 0.005); // Relative thickness
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.closePath();
    };

    const handleTimestampedDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = imageCanvasRef.current;
        if (!canvas) return;

        let clientX: number, clientY: number;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        const rect = canvas.getBoundingClientRect();
        const pos = { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };

        if (lastPosRef.current) {
            const ctx = canvas.getContext('2d');
            if (ctx) drawLine(ctx, lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y, canvas.width, canvas.height);

            // Send Stroke via Broadcast
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: "draw",
                    canvasTarget: 'image',
                    x0: lastPosRef.current.x,
                    y0: lastPosRef.current.y,
                    x1: pos.x,
                    y1: pos.y
                }));
            }
        }
        lastPosRef.current = pos;

        // Auto-Clear Ink after 3s of inactivity
        if (inkTimeoutRef.current) clearTimeout(inkTimeoutRef.current);
        inkTimeoutRef.current = setTimeout(() => {
            clearDrawingBox();
        }, 3000);
    };

    const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        setIsDrawing(true);
        const canvas = imageCanvasRef.current;
        if (canvas) {
            let clientX: number, clientY: number;
            if ('touches' in e) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            const rect = canvas.getBoundingClientRect();
            lastPosRef.current = { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
        }
    };

    const stopDraw = () => {
        setIsDrawing(false);
        lastPosRef.current = null;
    };

    const clearDrawingBox = () => {
        if (imageCanvasRef.current) {
            const ctx = imageCanvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, imageCanvasRef.current.width, imageCanvasRef.current.height);
        }
        activePolylinesRef.current.forEach(p => p.setMap(null));
        activePolylinesRef.current = [];
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "draw_clear" }));
        }
    };

    // Resize Canvas logic
    useEffect(() => {
        const resizeCanvas = () => {
            if (imageCanvasRef.current) {
                imageCanvasRef.current.width = imageCanvasRef.current.offsetWidth;
                imageCanvasRef.current.height = imageCanvasRef.current.offsetHeight;
            }
        };
        window.addEventListener('resize', resizeCanvas);
        setTimeout(resizeCanvas, 500); // Trigger after layout mounts
        return () => window.removeEventListener('resize', resizeCanvas);
    }, []);

    return (
        <div className="h-[100dvh] w-screen bg-[#0e1a14] flex flex-col font-sans overflow-hidden">
            <header className="bg-[#0e1a14] border-b border-brass/10 p-4 flex justify-between items-center z-10">
                <div>
                    <h1 className="text-xl font-heading font-black text-cream uppercase tracking-wider">Mission Control Pad</h1>
                    <p className="text-xs font-mono text-stone mt-1">Room {code} • Laser & Broadcast Ink Live</p>
                </div>
                <div className="flex gap-4 items-center">
                    {/* WebSocket Status Indicator */}
                    <div className={`ws-status ${
                        wsStatus === 'connected' ? 'ws-status-connected' :
                        wsStatus === 'reconnecting' ? 'ws-status-reconnecting' :
                        'ws-status-disconnected'
                    }`}>
                        <span className="ws-status-dot" />
                        <span>{wsStatus === 'connected' ? 'LIVE' : wsStatus === 'reconnecting' ? 'SYNCING' : 'OFFLINE'}</span>
                    </div>
                    <button
                        onClick={() => setDrawMode(!drawMode)}
                        className={`px-6 py-2 border rounded-sm font-mono font-bold uppercase tracking-widest transition-all ${drawMode
                            ? 'bg-teal/30 border-teal text-teal'
                            : 'bg-[#1a1a18]/60 border-brass/30 text-stone'
                            }`}
                    >
                        {drawMode ? '✏ Drawing ON' : '✏ Draw Mode'}
                    </button>
                    <button
                        onClick={clearDrawingBox}
                        className="px-6 py-2 bg-amber/15 hover:bg-amber/30 border border-amber/40 rounded-sm text-amber font-mono font-bold uppercase tracking-widest transition-all"
                    >
                        Clear Ink
                    </button>
                    <button
                        onClick={togglePause}
                        className="px-6 py-2 bg-rust/15 hover:bg-rust/30 border border-rust/40 rounded-sm text-rust font-mono font-bold uppercase tracking-widest transition-all"
                    >
                        Toggle Freeze Ray
                    </button>
                </div>
            </header>

            {/* Split Screen Container */}
            <div className="flex-1 flex w-full relative">

                {/* Visual Intel Output (Image view) */}
                <div className="w-1/2 relative border-r border-brass/10 bg-[#0a1210] flex flex-col">
                    <div className="p-3 bg-[#0e1a14] border-b border-brass/5 text-[10px] font-mono text-stone uppercase tracking-widest z-10 flex justify-between items-center">
                        <span>Primary Target Intel</span>
                        <span className="text-rust font-bold mix-blend-screen bg-[#0e1a14]/50 px-2 py-1 rounded">
                            DRAW TO BROADCAST
                        </span>
                    </div>
                    <div className="relative flex-1 group">
                        {location?.id ? (
                            <>
                                <img
                                    src={`/resources/image/${location.id}`}
                                    className="w-full h-full object-contain pointer-events-none"
                                    alt="Target Location"
                                />
                                {/* DRAWING LAYER */}
                                <canvas
                                    ref={imageCanvasRef}
                                    className="absolute inset-0 w-full h-full cursor-crosshair z-20 mix-blend-screen"
                                    style={{ pointerEvents: drawMode ? 'auto' : 'none' }}
                                    onMouseDown={(e) => startDraw(e)}
                                    onMouseMove={(e) => handleTimestampedDraw(e)}
                                    onMouseUp={stopDraw}
                                    onMouseLeave={stopDraw}
                                    onTouchStart={(e) => { e.preventDefault(); startDraw(e); }}
                                    onTouchMove={(e) => { e.preventDefault(); handleTimestampedDraw(e); }}
                                    onTouchEnd={stopDraw}
                                />
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-full text-stone/40 font-mono">LOADING VISUAL DATA...</div>
                        )}
                    </div>
                </div>

                {/* Map Interface */}
                <div className="w-1/2 relative bg-[#0a1210] flex flex-col">
                    <div className="p-3 bg-[#0e1a14] border-b border-brass/5 text-[10px] font-mono text-stone uppercase tracking-widest z-10 flex justify-between items-center">
                        <span>Tactical Sat-Link</span>
                        <span className="text-teal animate-pulse">● LIVE</span>
                    </div>
                    <div className="relative flex-1">
                        <div ref={mapRef} className="absolute inset-0 z-0" />

                        {/* DRAWING LAYER IS NOW HANDLED BY MAP INSTANCE */}
                    </div>
                    <div className="absolute bottom-4 left-4 bg-[#0e1a14]/80 backdrop-blur-md px-4 py-2 rounded-sm shadow border border-brass/10 text-[10px] font-mono pointer-events-none z-30">
                        <span className="text-brass font-bold block mb-1">Toggle DRAW MODE</span> to draw on screen. Normal click fires Laser.
                    </div>
                </div>
            </div>
        </div>
    );
}
