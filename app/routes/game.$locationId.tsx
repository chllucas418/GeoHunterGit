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
    const fetcher = useFetcher();
    const mapRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [marker, setMarker] = useState<google.maps.Marker | null>(null);
    const [selectedBox, setSelectedBox] = useState<BoxCoordinates | null>(null);
    const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    const actualMarkerRef = useRef<google.maps.Marker | null>(null);
    const polylineRef = useRef<google.maps.Polyline | null>(null);

    // Load Maps
    useEffect(() => {
        if (!mapsApiKey) return;

        // Initialize Loader Options
        setOptions({
            key: mapsApiKey,
            v: "weekly"
        });

        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;

            if (mapRef.current) {
                const map = new Map(mapRef.current, {
                    center: { lat: 22.3193, lng: 114.1694 }, // HK Center
                    zoom: 11,
                    streetViewControl: false,
                    mapTypeControl: false,
                    clickableIcons: false // Hide POIs
                });

                // Click listener
                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();

                        // Remove old marker
                        if (markerRef.current) markerRef.current.setMap(null);

                        const newMarker = new Marker({
                            position: { lat, lng },
                            map: map
                        });
                        markerRef.current = newMarker;
                        setGuess({ lat, lng });
                    }
                });

                setMapInstance(map);
            }
        };

        initMap();
    }, [mapsApiKey]);

    const result = fetcher.data as any;

    // Handle results visualization
    useEffect(() => {
        if (!result || !mapInstance || !guess) return;

        const actualCoord = location.geoPoint;

        // 1. Add Actual Marker (Red)
        if (!actualMarkerRef.current) {
            actualMarkerRef.current = new google.maps.Marker({
                position: actualCoord,
                map: mapInstance,
                icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png",
                title: "Actual Location"
            });
        }

        // 2. Draw Polyline
        if (!polylineRef.current) {
            polylineRef.current = new google.maps.Polyline({
                path: [guess, actualCoord],
                geodesic: true,
                strokeColor: "#3b82f6",
                strokeOpacity: 0.8,
                strokeWeight: 4,
                map: mapInstance
            });
        }

        // 3. Zoom to fit
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(guess);
        bounds.extend(actualCoord);
        mapInstance.fitBounds(bounds, { top: 100, bottom: 200, left: 100, right: 100 });

    }, [result, mapInstance, guess, location.geoPoint]);

    const handleSubmit = () => {
        if (!guess) return;

        const formData = new FormData();
        formData.append("locationId", location.id);
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        if (selectedBox) {
            formData.append("box", JSON.stringify(selectedBox));
        }

        fetcher.submit(formData, { method: "post", action: "/api/submit-turn" });
    };

    const result = fetcher.data as any;

    return (
        <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-slate-900 text-slate-50">
            {/* Back Button */}
            <Link
                to="/"
                className="absolute top-4 left-4 z-50 bg-slate-900/50 backdrop-blur px-3 py-2 rounded-full border border-slate-700 hover:bg-slate-800 transition-all text-xs font-bold"
            >
                ← Back
            </Link>
            {/* Left: View (Evidence) */}
            <div className="flex-1 relative border-r border-slate-700">
                <div className="absolute inset-0">
                    <EvidenceCanvas
                        imageUrl={location.imageUrl}
                        onBoxChange={setSelectedBox}
                        disabled={fetcher.state !== "idle" || !!result}
                    />
                </div>
                {/* Overlay Result */}
                {result && (
                    <div className="absolute inset-x-0 bottom-0 bg-slate-900/90 p-6 backdrop-blur space-y-2 animate-slide-up">
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Turn Complete!
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-slate-400 uppercase text-xs">Score</p>
                                <p className="text-xl font-bold text-blue-400">{result.score}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 uppercase text-xs">Distance</p>
                                <p className="text-xl">{Math.round(result.distance)}m</p>
                            </div>
                        </div>
                        {fetcher.state !== "idle" && !result && (
                            <div className="mt-2 text-sm bg-slate-800 p-2 rounded border border-slate-700 animate-pulse">
                                <span className="text-blue-400 font-bold">Gemini: </span>
                                Analyzing your evidence...
                            </div>
                        )}
                        {result?.aiFeedback && (
                            <div className="mt-2 text-sm bg-slate-800 p-2 rounded border border-slate-700">
                                <span className="text-blue-400 font-bold">Gemini: </span>
                                {result.aiFeedback.explanation || result.aiFeedback.comment || result.aiFeedback.error || "Analyzing..."}
                            </div>
                        )}
                        <div className="mt-4">
                            <Link to="/" className="text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-1">
                                ← Back to Discovery
                            </Link>
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Map */}
            <div className="flex-1 relative">
                <div ref={mapRef} className="w-full h-full" />

                {/* Controls */}
                {!result && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-64">
                        <button
                            onClick={handleSubmit}
                            disabled={!guess || fetcher.state !== "idle"}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full shadow-lg transition-transform active:scale-95"
                        >
                            {fetcher.state === "submitting" ? "Verifying..." : "Make Guess"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
