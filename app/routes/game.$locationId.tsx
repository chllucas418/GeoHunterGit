import { useRef, useState, useEffect } from "react";
import type { Route } from "./+types/game.$locationId"; // RR7 Typegen
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore/lite";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates, Location } from "~/types/shared"; // Import shared types

// Loader to fetch location
export async function loader({ params, context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const FIREBASE_CONFIG = JSON.parse(env.FIREBASE_CONFIG || '{}');
    const MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY; // Pass to client

    const app = initializeApp(FIREBASE_CONFIG);
    const db = getFirestore(app);

    const locRef = doc(db, "locations", params.locationId as string);
    const snap = await getDoc(locRef);

    if (!snap.exists()) {
        throw new Response("Location Not Found", { status: 404 });
    }

    // Serialize data (Firestore timestamps etc might need conversion)
    return {
        location: { id: snap.id, ...snap.data() } as Location,
        mapsApiKey: MAPS_API_KEY,
        firebaseConfig: FIREBASE_CONFIG
    };
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

    // Load Maps
    useEffect(() => {
        if (!mapsApiKey) return;

        // Initialize Loader Options
        setOptions({
            key: mapsApiKey,
            v: "weekly"
        });

        const initMap = async () => {
            // Functional importLibrary approach
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

    const handleSubmit = () => {
        if (!guess) return;

        // Optimistic UI or wait?
        const formData = new FormData();
        formData.append("userId", "test-user-uid"); // TODO: Real Auth
        formData.append("locationId", location.id);
        formData.append("lat", guess.lat.toString());
        formData.append("lng", guess.lng.toString());
        if (selectedBox) {
            formData.append("box", JSON.stringify(selectedBox));
        }

        fetcher.submit(formData, { method: "post", action: "/api/submit-turn" });
    };

    const result = fetcher.data as any; // Typed response from action

    return (
        <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-slate-900 text-slate-50">
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
                                <p className="text-slate-400 uppercase text-xs">Distance Score</p>
                                <p className="text-xl">{Math.round(result.score - (result.aiFeedback?.validity > 0.7 ? 1000 : 0))}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 uppercase text-xs">AI Bonus</p>
                                <p className="text-xl text-yellow-400">+{result.aiFeedback?.validity > 0.7 ? 1000 : 0}</p>
                            </div>
                        </div>
                        {result.aiFeedback && (
                            <div className="mt-2 text-sm bg-slate-800 p-2 rounded border border-slate-700">
                                <span className="text-blue-400 font-bold">Gemini: </span>
                                {result.aiFeedback.explanation || result.aiFeedback.error}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Right: Map */}
            <div className="flex-1 relative">
                <div ref={mapRef} className="w-full h-full" />

                {/* Controls */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-64">
                    <button
                        onClick={handleSubmit}
                        disabled={!guess || fetcher.state !== "idle" || !!result}
                        className="w-full py-3 bg-[#4285F4] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full shadow-lg transition-transform active:scale-95"
                    >
                        {fetcher.state === "submitting" ? "Verifying..." : "Make Guess"}
                    </button>
                </div>
            </div>
        </div>
    );
}
