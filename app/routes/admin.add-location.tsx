import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    return { mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const imageUrl = formData.get("imageUrl") as string;
    const lat = parseFloat(formData.get("lat") as string);
    const lng = parseFloat(formData.get("lng") as string);
    const difficulty = parseInt(formData.get("difficulty") as string);

    if (!imageUrl || isNaN(lat) || isNaN(lng)) {
        return { error: "All fields are required" };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const id = `loc_${Math.random().toString(36).substring(2, 9)}`;

    try {
        await db.prepare(
            "INSERT INTO locations (id, image_url, lat, lng, difficulty_rating) VALUES (?, ?, ?, ?, ?)"
        ).bind(id, imageUrl, lat, lng, difficulty).run();

        return { success: true, message: `Location added! (ID: ${id})` };
    } catch (e) {
        console.error("Add location error:", e);
        return { error: "Failed to add location" };
    }
}

export default function AddLocation() {
    const { mapsApiKey } = useLoaderData<typeof loader>();
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const mapRef = useRef<HTMLDivElement>(null);
    const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);

    useEffect(() => {
        if (!mapsApiKey) return;

        setOptions({ key: mapsApiKey, v: "weekly" });

        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;

            if (mapRef.current) {
                const map = new Map(mapRef.current, {
                    center: { lat: 22.3193, lng: 114.1694 },
                    zoom: 11,
                });

                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();

                        if (markerRef.current) markerRef.current.setMap(null);

                        const newMarker = new Marker({
                            position: { lat, lng },
                            map: map
                        });
                        markerRef.current = newMarker;
                        setMarker({ lat, lng });
                    }
                });
            }
        };

        initMap();
    }, [mapsApiKey]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <header>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                        Developer Protocol: Add Location
                    </h1>
                    <p className="text-slate-500">Pinpoint a new image and its coordinates.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Form method="post" className="space-y-6 bg-slate-900 p-6 rounded-2xl border border-slate-800">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Image URL</label>
                            <input
                                name="imageUrl"
                                type="url"
                                required
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                placeholder="https://..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Selected Coordinates</label>
                            <div className="grid grid-cols-2 gap-4">
                                <input
                                    name="lat"
                                    type="text"
                                    readOnly
                                    value={marker?.lat ?? ""}
                                    placeholder="Latitude"
                                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-500"
                                />
                                <input
                                    name="lng"
                                    type="text"
                                    readOnly
                                    value={marker?.lng ?? ""}
                                    placeholder="Longitude"
                                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-500"
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Click on the map to set coordinates.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Difficulty Rating (1-10)</label>
                            <input
                                name="difficulty"
                                type="range"
                                min="1"
                                max="10"
                                defaultValue="5"
                                className="w-full accent-blue-500"
                            />
                        </div>

                        {actionData?.error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-xl">
                                {actionData.error}
                            </div>
                        )}

                        {actionData?.success && (
                            <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-xl">
                                {actionData.message}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting || !marker}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-900/20"
                        >
                            {isSubmitting ? "Saving..." : "Upload Location"}
                        </button>
                    </Form>

                    <div className="h-[500px] rounded-2xl overflow-hidden border border-slate-800 relative shadow-2xl">
                        <div ref={mapRef} className="w-full h-full" />
                        {!marker && (
                            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                                <p className="bg-slate-900 px-4 py-2 rounded-full border border-slate-700 text-sm font-medium">Click to pick location</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
