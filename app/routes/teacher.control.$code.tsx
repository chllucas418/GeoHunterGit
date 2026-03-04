import { useLoaderData } from "react-router";
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
        currentItem = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, room.current_index).first<any>();

        if (currentItem) {
            location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(currentItem.location_id).first<any>();
        }
    }

    return { code, room, location, mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export default function TeacherControlPanel() {
    const { code, location, mapsApiKey } = useLoaderData() as any;

    const [ws, setWs] = useState<WebSocket | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const laserMarkerRef = useRef<google.maps.Marker | null>(null);
    const cursorsRef = useRef<Record<string, google.maps.Marker>>({});

    // Setup WebSocket
    useEffect(() => {
        const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/api/room/${code}/ws`;
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

                // Set center to Current Location or default Tuen Mun
                const centerNode = location ? { lat: location.lat, lng: location.lng } : { lat: 22.3964, lng: 113.9725 };

                const map = new Map(mapRef.current!, {
                    center: centerNode,
                    zoom: 14,
                    disableDefaultUI: true,
                    mapTypeId: "hybrid",
                });

                if (location) {
                    new google.maps.Marker({
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

                    // Auto hide laser after 2s
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
    }, [mapsApiKey, mapInstance, ws, location]);

    const togglePause = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pause_toggle" }));
        }
    };

    return (
        <div className="h-[100dvh] w-screen bg-black flex flex-col font-sans">
            <header className="bg-slate-900 border-b border-white/10 p-4 flex justify-between items-center z-10">
                <div>
                    <h1 className="text-xl font-black text-white uppercase tracking-wider">Mission Control Pad</h1>
                    <p className="text-xs font-mono text-slate-400 mt-1">Room {code} • Live Sat-Link</p>
                </div>
                <button
                    onClick={togglePause}
                    className="px-6 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500 rounded text-red-400 font-bold uppercase tracking-widest transition-all"
                >
                    Toggle Freeze Ray
                </button>
            </header>

            <div className="flex-1 relative cursor-crosshair">
                <div ref={mapRef} className="w-full h-full" />

                {/* HUD Overlay */}
                <div className="absolute inset-0 pointer-events-none p-6">
                    <div className="text-[10px] font-mono text-blue-400 bg-blue-900/40 inline-block px-3 py-1 rounded border border-blue-500/30 blur-sm">
                        LASER LINK ONLINE
                    </div>
                </div>

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 pointer-events-none text-center">
                    <p className="text-sm font-bold text-white tracking-widest uppercase">Tap map to fire laser</p>
                    <p className="text-[10px] text-slate-400">Blue dots indicate live student cursors</p>
                </div>
            </div>
        </div>
    );
}
