import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireTeacher } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

export async function loader({ request, params, context }: any) {
    await requireTeacher(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    return { code, room, mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export default function TeacherControlPanel() {
    const { code, room, mapsApiKey } = useLoaderData() as any;
    const fetcher = useFetcher();

    const [ws, setWs] = useState<WebSocket | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const laserMarkerRef = useRef<google.maps.Marker | null>(null);
    const cursorsRef = useRef<Record<string, google.maps.Marker>>({});

    // Setup WebSocket
    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/room/${code}/ws`;

        const socket = new WebSocket(wsUrl);
        socket.onopen = () => console.log("Control WS Connected");

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

        socket.onclose = () => console.log("Control WS Closed");

        setWs(socket);
        return () => socket.close();
    }, [code, mapInstance]);

    // Setup Map
    useEffect(() => {
        if (!mapInstance && mapRef.current) {
            setOptions({ key: mapsApiKey });
            importLibrary("maps").then(async () => {
                const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
                const map = new Map(mapRef.current!, {
                    center: { lat: 22.3964, lng: 113.9725 },
                    zoom: 12,
                    disableDefaultUI: true,
                    mapTypeId: "hybrid",
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    const lat = e.latLng!.lat();
                    const lng = e.latLng!.lng();

                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "laser", lat, lng }));
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
                });

                setMapInstance(map);
            });
        }
    }, [mapsApiKey, ws, mapInstance]);

    const togglePause = () => {
        const formData = new FormData();
        formData.append("intent", "TOGGLE_PAUSE");
        fetcher.submit(formData, { method: "post", action: `/api/room/${code}/action` });

        // Broadcast over WS for instant visual effect just in case polling is slow
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pause_toggle" }));
        }
    };

    return (
        <div className="h-[100dvh] w-screen bg-slate-950 text-white flex flex-col md:flex-row overflow-hidden">
            {/* Sidebar */}
            <div className="w-full md:w-80 shrink-0 border-r border-white/10 p-6 flex flex-col gap-6 overflow-y-auto">
                <div>
                    <h1 className="text-2xl font-black uppercase tracking-widest text-blue-400">Control Pad</h1>
                    <p className="text-xs text-slate-500 font-mono">Session: {code}</p>
                </div>

                <button
                    onClick={togglePause}
                    className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold uppercase tracking-widest shadow-lg shadow-cyan-500/20 active:scale-95 transition-all flex justify-center items-center gap-2"
                >
                    <span>❄️</span> Freeze Ray
                </button>
                <p className="text-[10px] text-slate-400 leading-relaxed uppercase tracking-widest">
                    Disables student controls and blurs screens to enforce attention on the main board.
                </p>

                <hr className="border-white/10" />

                <div>
                    <h3 className="text-sm font-bold uppercase text-red-400 mb-2 flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                        Laser Pointer
                    </h3>
                    <p className="text-[10px] text-slate-400 leading-relaxed uppercase tracking-widest">
                        Tap anywhere on the map to send a synchronized red ping to all connected student displays. Use this to guide their analysis directly.
                    </p>
                </div>

                <div className="mt-auto pt-8">
                    <Link to={`/teacher/room/${code}`} className="block text-center py-3 border border-white/20 rounded-xl hover:bg-white/5 text-[10px] font-bold uppercase tracking-widest transition-all">
                        Back to Projection Board
                    </Link>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative">
                <div ref={mapRef} className="w-full h-full" />
                <div className="absolute top-4 left-4 bg-black/80 backdrop-blur-md px-4 py-2 border border-blue-500/30 rounded-lg pointer-events-none z-10">
                    <span className="text-[10px] uppercase font-mono text-blue-300 font-bold tracking-[0.2em] flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                        Targeting Grid Active
                    </span>
                </div>
            </div>
        </div>
    );
}
