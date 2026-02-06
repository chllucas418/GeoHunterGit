import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useState, useRef } from "react";
import { requireUser } from "~/lib/auth.server";
import { Loader } from "@googlemaps/js-api-loader";

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

    const [roomState, setRoomState] = useState<any>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [guess, setGuess] = useState<{ lat: number, lng: number } | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [result, setResult] = useState<any>(null); // Last round result

    // 1. Polling
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
            // Detect state change to reset for new round
            if (roomState?.room.current_index !== newData.room.current_index) {
                // New Round Started!
                setGuess(null);
                setSubmitted(false);
                setResult(null);
                if (marker) marker.setMap(null);
                setMarker(null);
                if (mapInstance) {
                    mapInstance.setZoom(2);
                    mapInstance.setCenter({ lat: 20, lng: 0 });
                }
            }
            setRoomState(newData);
        }
    }, [fetcher.data]);

    // 2. Map Init (Only when Playing)
    const mapRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (roomState?.room.status === 'PLAYING' && !mapInstance && mapRef.current) {
            const loader = new Loader({
                apiKey: mapsApiKey,
                version: "weekly",
            }) as any;
            loader.importLibrary("maps").then(async () => {
                const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
                const map = new Map(mapRef.current!, {
                    center: { lat: 22.3193, lng: 114.1694 }, // Default HK
                    zoom: 11,
                    disableDefaultUI: true,
                    clickableIcons: false,
                    mapId: "DEMO_MAP_ID", // TODO: user env map id
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (submitted) return;

                    const lat = e.latLng!.lat();
                    const lng = e.latLng!.lng();
                    setGuess({ lat, lng });

                    // Update local marker
                    if (marker) {
                        marker.setPosition({ lat, lng });
                    } else {
                        const newMarker = new google.maps.Marker({
                            position: { lat, lng },
                            map: map,
                        });
                        setMarker(newMarker);
                        // Hack to persist marker ref
                        // setMarker(newMarker) inside a closure is tricky if marker is state.
                        // Ideally use Ref for marker to update it immediately.
                    }
                });

                setMapInstance(map);
            });
        }
    }, [roomState?.room.status, mapsApiKey]);

    // Update marker effect separately if marker state issues arise
    useEffect(() => {
        if (!mapInstance || !guess) return;
        if (!marker) {
            const m = new google.maps.Marker({ position: guess, map: mapInstance });
            setMarker(m);
        } else {
            marker.setPosition(guess);
        }
    }, [guess, mapInstance]);


    // --- SUBMIT HANDLER ---
    const handleSubmit = () => {
        if (!guess) return;
        setSubmitted(true);
        actionFetcher.submit(
            { lat: guess.lat, lng: guess.lng },
            { method: "post", action: `/api/room/${code}/submit` }
        );
    };

    // Watch for submit result
    useEffect(() => {
        if (actionFetcher.data) {
            // We got points back!
            setResult(actionFetcher.data);
        }
    }, [actionFetcher.data]);

    if (!roomState) return <div className="p-8 text-white text-center">Locating Mission Signal...</div>;

    const { room, currentRound } = roomState;

    // --- SUBMIT HANLDER ---



    // --- RENDERS ---

    if (room.status === 'WAITING') {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                <div className="loader mb-8 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <h1 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Stand By</h1>
                <p className="text-slate-400 max-w-xs mx-auto">
                    Waiting for Command to initiate sequence...
                </p>
            </div>
        );
    }

    if (room.status === 'PLAYING') {
        // We can show image split screen OR just map if we assume they look at projector
        // User request: "Teacher will show the image on the big projector... students will play"
        // Usually students SHOULD see the image on their device too for detail.
        // Let's implement a toggle or split. For mobile optimization, maybe Tabs?
        // Or just Map on top, small image preview?

        return (
            <div className="h-screen flex flex-col bg-slate-900">
                {/* Image Preview (Collapsible?) */}
                <div className="h-[30vh] bg-black relative">
                    {currentRound?.location?.image_url ? (
                        <img src={currentRound.location.image_url} className="w-full h-full object-contain" alt="Target" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-white/50">Target Data Corrupted</div>
                    )}
                </div>

                {/* Map Area */}
                <div className="flex-1 relative">
                    <div ref={mapRef} className="absolute inset-0 z-0" />

                    {/* Controls */}
                    <div className="absolute bottom-6 left-6 right-6 z-10">
                        {submitted ? (
                            <div className="bg-emerald-500 text-white font-bold p-4 rounded-xl text-center shadow-lg animate-in slide-in-from-bottom-5">
                                LOC LOCKED IN
                                {result && <div className="text-sm font-normal opacity-90 mt-1">Waiting for results...</div>}
                            </div>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={!guess}
                                className={`w-full py-4 text-xl font-black uppercase tracking-widest rounded-xl shadow-xl transition-all
                                    ${guess ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}
                                `}
                            >
                                LOCK COORDINATES
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (room.status === 'REVIEW') {
        return (
            <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
                {result ? (
                    <div className="space-y-6">
                        <h2 className="text-xl text-slate-400 uppercase tracking-widest">Round Performance</h2>
                        <div className="text-6xl font-black text-white">{result.points} <span className="text-2xl text-slate-500">pts</span></div>
                        <div className="bg-white/10 px-6 py-2 rounded-full inline-block">
                            {result.distance < 1 ?
                                `${Math.round(result.distance * 1000)}m error` :
                                `${result.distance.toFixed(1)}km error`
                            }
                        </div>
                    </div>
                ) : (
                    <div className="text-slate-400">Did not submit in time.</div>
                )}
                <div className="mt-12 text-sm text-slate-500 animate-pulse">Waiting for Next Location...</div>
            </div>
        );
    }

    if (room.status === 'PODIUM') {
        return (
            <div className="h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
                <h1 className="text-4xl font-black text-white mb-4">MISSION DEBRIEF</h1>
                <p className="text-slate-400">Check the main screen for final rankings.</p>
                <a href="/" className="mt-12 px-8 py-3 bg-white/10 rounded-xl text-white font-bold">Leave Session</a>
            </div>
        );
    }

    return null;
}
