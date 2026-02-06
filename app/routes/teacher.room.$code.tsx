import { Form, useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireTeacher } from "~/lib/auth.server";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
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

    // --- REVIEW MAP LOGIC ---
    const mapRef = useRef<HTMLDivElement>(null);
    const [reviewMap, setReviewMap] = useState<google.maps.Map | null>(null);
    const markersRef = useRef<google.maps.Marker[]>([]);

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

                if (currentRound?.location) {
                    new google.maps.Marker({
                        position: { lat: currentRound.location.lat, lng: currentRound.location.lng },
                        map,
                        title: "Target Location",
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 10,
                            fillColor: "#10b981",
                            fillOpacity: 1,
                            strokeColor: "#ffffff",
                            strokeWeight: 2,
                        }
                    });
                }

                // Fetch guesses
                fetch(`/api/room/${code}/review?round=${room.current_index}`).then(res => res.json()).then((data: any) => {
                    if (data.guesses) {
                        const bounds = new google.maps.LatLngBounds();
                        if (currentRound?.location) {
                            bounds.extend({ lat: currentRound.location.lat, lng: currentRound.location.lng });
                        }

                        data.guesses.forEach((g: any) => {
                            const m = new google.maps.Marker({
                                position: { lat: g.lat, lng: g.lng },
                                map,
                                label: {
                                    text: g.user_name[0],
                                    color: "white",
                                    fontWeight: "bold"
                                },
                                title: `${g.user_name} (${Math.round(g.distance * 1000)}m)`,
                            });
                            markersRef.current.push(m);
                            bounds.extend({ lat: g.lat, lng: g.lng });
                        });

                        map.fitBounds(bounds);
                    }
                });
            });
        }

        if (status !== 'REVIEW' && reviewMap) {
            setReviewMap(null);
            markersRef.current = [];
        }
    }, [roomState, mapsApiKey]); // Depend on roomState, not room.status which might crash


    // Polling Logic
    useEffect(() => {
        // Initial load
        fetcher.load(`/api/room/${code}/status`);

        const interval = setInterval(() => {
            if (fetcher.state === "idle") {
                fetcher.load(`/api/room/${code}/status`);
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [code]);

    // Update local state when fetcher returns data
    useEffect(() => {
        if (fetcher.data) {
            const data = fetcher.data as any;
            setRoomState(data);

            // Sync Timer if playing
            if (data.room.status === 'PLAYING' && data.currentRound) {
                const elapsedSec = Math.floor((Date.now() - data.currentRound.startTime) / 1000);
                const remaining = Math.max(0, 300 - elapsedSec);
                setTimeLeft(remaining);

                if (remaining === 0) {
                    // Auto-skip logic could go here, but safer to let teacher control or backend handle
                }
            }
        }
    }, [fetcher.data]);

    if (!roomState) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Connecting to HQ...</div>;

    const { room, participants, currentRound } = roomState;

    // --- RENDERERS ---

    const renderLobby = () => (
        <div className="flex flex-col items-center justify-center h-full space-y-12 animate-in fade-in">
            <div className="text-center space-y-4">
                <p className="text-2xl uppercase font-bold text-blue-400 tracking-widest">Join at geohunter.com/join</p>
                <h1 className="text-9xl font-black text-white tracking-tighter bg-white/10 px-12 py-6 rounded-3xl border-4 border-dashed border-white/20">
                    {code}
                </h1>
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

    const renderPlaying = () => (
        <div className="h-full flex flex-col relative">
            {/* Header / Timer */}
            <div className="absolute top-0 inset-x-0 z-50 p-6 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
                <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-xl border border-white/10">
                    <span className="text-lg font-mono font-bold text-blue-300">ROUND {currentRound.index + 1}/{currentRound.total}</span>
                </div>
                <div className={`text-6xl font-black font-mono tracking-tighter drop-shadow-lg ${timeLeft < 30 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                    {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                </div>
                <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-xl border border-white/10">
                    <span className="text-lg font-mono font-bold text-green-300">{participants.length} Active</span>
                </div>
            </div>

            {/* Full screen Image */}
            {currentRound?.location?.image_url && (
                <div className="absolute inset-0 z-0">
                    <img
                        src={currentRound.location.image_url}
                        className="w-full h-full object-cover"
                        alt="Location"
                    />
                </div>
            )}

            {/* Teacher Control */}
            <div className="absolute bottom-12 right-12 z-50">
                <button
                    onClick={() => actionFetcher.submit({ action: "SKIP_TIMER" }, { method: "post", action: `/api/room/${code}/action` })}
                    className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/20 rounded-2xl text-white font-bold uppercase tracking-widest hover:scale-105 transition-all"
                >
                    Reveal Intel →
                </button>
            </div>
        </div>
    );

    // --- REVIEW MAP LOGIC MOVED TO TOP ---

    const renderReview = () => (
        <div className="h-full flex overflow-hidden">
            {/* Left: Stats & Controls */}
            <div className="w-1/3 bg-slate-900/90 backdrop-blur-xl border-r border-white/10 p-8 flex flex-col z-10 relative shadow-2xl">
                <div className="mb-8">
                    <p className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-2">Target Revealed</p>
                    <h2 className="text-3xl font-black text-white leading-tight">
                        {currentRound?.location?.id || "Unknown Sector"}
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 sticky top-0 bg-slate-900 py-2">
                        Top Gun Agents
                    </h3>
                    {participants.map((p: any, i: number) => (
                        <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-white/5 border-white/5'}`}>
                            <div className="flex items-center gap-3">
                                <span className={`font-mono font-bold ${i === 0 ? 'text-yellow-400' : 'text-slate-500'}`}>#{i + 1}</span>
                                <span className="font-bold text-white">{p.display_name}</span>
                            </div>
                            <span className="font-mono text-blue-300">{p.score}</span>
                        </div>
                    ))}
                </div>

                <div className="mt-8 pt-8 border-t border-white/10">
                    <button
                        onClick={() => actionFetcher.submit({ action: "NEXT_ROUND" }, { method: "post", action: `/api/room/${code}/action` })}
                        className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white text-xl font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all transform hover:scale-[1.02]"
                    >
                        Next Location →
                    </button>
                </div>
            </div>

            {/* Right: Map */}
            <div className="flex-1 relative bg-slate-800">
                <div ref={mapRef} className="absolute inset-0 w-full h-full" />

                {/* Image Overlay (Mini) */}
                {currentRound?.location?.image_url && (
                    <div className="absolute top-6 right-6 w-64 aspect-video rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 hover:scale-150 transition-transform origin-top-right">
                        <img src={currentRound.location.image_url} className="w-full h-full object-cover" />
                    </div>
                )}
            </div>
        </div>
    );

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
