import { useRef, useState, useEffect } from "react";
import type { Route } from "./+types/game.$locationId";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import { requireUser } from "~/lib/auth.server";
import type { BoxCoordinates, Location } from "~/types/shared";

// Loader to fetch location
export async function loader({ params, request, context }: LoaderFunctionArgs) {
    await requireUser(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY;

    const locationId = params.locationId;
    const loc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(locationId).first<any>();

    if (!loc) {
        throw new Response("Location Not Found", { status: 404 });
    }

    const location: Location = {
        id: loc.id,
        imageUrl: loc.image_url,
        geoPoint: { lat: loc.lat, lng: loc.lng },
        difficultyRating: loc.difficulty_rating,
        qualityScore: loc.quality_score,
        verifiedByGemini: !!loc.verified_by_gemini
    };

    return { location, mapsApiKey: MAPS_API_KEY };
}

export default function GameRoute({ loaderData }: Route.ComponentProps) {
    const { location, mapsApiKey } = loaderData;
    const fetcher = useFetcher() as any;
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [selectedBox, setSelectedBox] = useState<BoxCoordinates | null>(null);
    const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const actualMarkerRef = useRef<google.maps.Marker | null>(null);
    const polylineRef = useRef<google.maps.Polyline | null>(null);

    const result = fetcher.data;
    const isSubmitting = fetcher.state !== "idle";

    // Load Maps
    useEffect(() => {
        if (!mapsApiKey) return;

        setOptions({ key: mapsApiKey, v: "weekly" });

        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;

            if (mapRef.current) {
                const map = new Map(mapRef.current, {
                    center: { lat: 22.3193, lng: 114.1694 }, // HK Center
                    zoom: 11,
                    disableDefaultUI: true, // Clean UI
                    styles: [
                        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                        // ... dark mode map styles
                    ]
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng && !result) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();
                        if (markerRef.current) markerRef.current.setMap(null);
                        markerRef.current = new Marker({ position: { lat, lng }, map: map });
                        setGuess({ lat, lng });
                    }
                });

                setMapInstance(map);
            }
        };

        initMap();
    }, [mapsApiKey]);

    // Handle results visualization
    useEffect(() => {
        if (!result || !mapInstance || !guess) return;

        const actualCoord = location.geoPoint;

        if (!actualMarkerRef.current) {
            actualMarkerRef.current = new google.maps.Marker({
                position: actualCoord,
                map: mapInstance,
                icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png",
                title: "Actual Location"
            });
        }

        if (!polylineRef.current) {
            polylineRef.current = new google.maps.Polyline({
                path: [guess, actualCoord],
                geodesic: true,
                strokeColor: "#60a5fa", // Blue-400
                strokeOpacity: 0.8,
                strokeWeight: 4,
                map: mapInstance
            });
        }

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(guess);
        bounds.extend(actualCoord);
        mapInstance.fitBounds(bounds, { top: 100, bottom: 300, left: 100, right: 100 });

    }, [result, mapInstance, guess, location.geoPoint]);

    const handleSubmit = () => {
        if (!guess) return;
        const formData = new FormData();
        formData.append("locationId", location.id);
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        if (selectedBox) formData.append("box", JSON.stringify(selectedBox));
        fetcher.submit(formData, { method: "post", action: "/api/submit-turn" });
    };

    return (
        <div className="h-[100dvh] w-screen relative overflow-hidden bg-black text-white">

            {/* --- IMMERSIVE EVIDENCE LAYER --- */}
            <div className={`absolute inset-0 transition-all duration-700 ${guess ? 'h-1/2 md:h-full md:w-1/2' : 'h-full w-full'}`}>
                <EvidenceCanvas
                    imageUrl={location.imageUrl}
                    onBoxChange={setSelectedBox}
                    disabled={!!result}
                />
                <div className="absolute top-0 left-0 p-6 z-10 w-full bg-gradient-to-b from-black/80 to-transparent">
                    <div className="flex justify-between items-start">
                        <Link to="/" className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-xs font-bold transition-all border border-white/10">
                            ← ABORT MISSION
                        </Link>
                        <div className="text-right">
                            <h1 className="text-3xl font-black tracking-tighter">TARGET #{location.id.slice(-4).toUpperCase()}</h1>
                            <p className="text-xs font-mono text-blue-300 opacity-80">LAT-UNKNOWN // LNG-UNKNOWN</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- TACTICAL MAP LAYER --- */}
            <div className={`absolute bottom-0 right-0 transition-all duration-700 shadow-2xl z-20 overflow-hidden border-t-2 md:border-t-0 md:border-l-2 border-white/10 
                ${guess ? 'h-1/2 w-full md:h-full md:w-1/2' : 'h-48 w-48 bottom-6 right-6 rounded-3xl opacity-90 hover:opacity-100 hover:scale-105'}
            `}>
                <div ref={mapRef} className="w-full h-full bg-slate-800" />

                {/* Floating Map Controls */}
                {!result && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xs px-4">
                        <button
                            onClick={handleSubmit}
                            disabled={!guess || isSubmitting}
                            className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all border border-white/10 backdrop-blur-xl
                                ${guess
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white translate-y-0 opacity-100'
                                    : 'bg-black/40 text-white/20 translate-y-10 opacity-0 pointer-events-none'
                                }
                            `}
                        >
                            {isSubmitting ? "CALCULATING..." : "CONFIRM COORDINATES"}
                        </button>
                    </div>
                )}
            </div>

            {/* --- HUD RESULT OVERLAY --- */}
            {result && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in zoom-in duration-300">
                    <div className="bg-black/80 border border-white/10 p-8 md:p-12 rounded-[3rem] max-w-2xl w-full shadow-2xl space-y-8 relative overflow-hidden">
                        {/* Glow effect */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />

                        <div className="relative text-center space-y-2">
                            <p className="text-xs font-mono text-blue-400 uppercase tracking-[0.3em]">Mission Debrief</p>
                            <h2 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50">
                                {result.score}
                            </h2>
                            <div className="flex items-center justify-center gap-4 text-sm font-bold text-white/60">
                                <span>{Math.round(result.distance)}m Deviation</span>
                                <span>•</span>
                                <span>{result.aiFeedback?.validity > 0.5 ? "+AI BONUS" : "NO AI LOCK"}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                            <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                                <p className="text-[10px] uppercase font-bold text-white/40 mb-2">Tactical Assessment</p>
                                <p className="text-sm leading-relaxed text-white/80">
                                    {result.aiFeedback?.explanation || "Accessing satellite imagery..."}
                                </p>
                            </div>
                            <div className="p-6 rounded-3xl bg-white/5 border border-white/10 flex flex-col justify-center items-center">
                                <Link to="/" className="w-full py-4 bg-white text-black font-black uppercase tracking-widest text-center rounded-xl hover:bg-blue-50 transition-colors">
                                    Next Target
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
