import { useRef, useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation, useLoaderData, Link } from "react-router";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { EvidenceCanvas } from "~/components/EvidenceCanvas";
import type { BoxCoordinates } from "~/types/shared";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    return { mapsApiKey: env.GOOGLE_MAPS_API_KEY };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const formData = await request.formData();

    // Support either direct URL or Base64 upload
    let imageUrl = formData.get("imageUrl") as string;
    const base64Image = formData.get("base64Image") as string;
    if (base64Image) imageUrl = base64Image;

    const lat = parseFloat(formData.get("lat") as string);
    const lng = parseFloat(formData.get("lng") as string);
    const difficulty = parseInt(formData.get("difficulty") as string);
    const evidenceJson = formData.get("evidence") as string; // marked area

    if (!imageUrl || isNaN(lat) || isNaN(lng)) {
        return { error: "Image and coordinates are required" };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const id = `loc_${Math.random().toString(36).substring(2, 9)}`;

    try {
        await db.prepare(
            "INSERT INTO locations (id, image_url, lat, lng, difficulty_rating, quality_score, verified_by_gemini) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, imageUrl, lat, lng, difficulty, 100, 1).run(); // Auto-verify and 100 quality for developer adds

        // In a real app we'd store the evidence box too. For now, it's captured.
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
    const markerRef = useRef<any>(null);
    const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string>("");
    const [base64, setBase64] = useState<string>("");
    const [evidenceStep, setEvidenceStep] = useState(false);
    const [selectedBox, setSelectedBox] = useState<BoxCoordinates | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setPreviewUrl(result);
                setBase64(result);
            };
            reader.readAsDataURL(file);
        }
    };

    useEffect(() => {
        if (!mapsApiKey) return;
        setOptions({ key: mapsApiKey, v: "weekly" });
        const initMap = async () => {
            const { Map } = await importLibrary("maps") as google.maps.MapsLibrary;
            const { Marker } = await importLibrary("marker") as google.maps.MarkerLibrary;
            if (mapRef.current) {
                const map = new Map(mapRef.current, { center: { lat: 22.3193, lng: 114.1694 }, zoom: 11 });
                map.addListener("click", (e: google.maps.MapMouseEvent) => {
                    if (e.latLng) {
                        const lat = e.latLng.lat();
                        const lng = e.latLng.lng();
                        setMarker({ lat, lng });

                        if (markerRef.current) {
                            markerRef.current.position = e.latLng;
                        } else {
                            markerRef.current = new Marker({
                                position: e.latLng,
                                map: map,
                                title: "Target Location",
                            });
                        }
                    }
                });
            }
        };
        initMap();
    }, [mapsApiKey]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back to Discovery</Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Developer Protocol: Add Location
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {selectedBox && (
                            <span className="text-green-400 text-sm font-bold flex items-center gap-1">
                                Evidence Marked ✅
                            </span>
                        )}
                        {previewUrl && (
                            <button
                                onClick={() => setEvidenceStep(!evidenceStep)}
                                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-all"
                            >
                                {evidenceStep ? "Edit Details" : "Mark Evidence area"}
                            </button>
                        )}
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {!evidenceStep ? (
                        <Form method="post" className="space-y-6 bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl">
                            <input type="hidden" name="base64Image" value={base64} />
                            <input type="hidden" name="lat" value={marker?.lat ?? ""} />
                            <input type="hidden" name="lng" value={marker?.lng ?? ""} />
                            <input type="hidden" name="evidence" value={JSON.stringify(selectedBox)} />

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 1: Upload Image</label>
                                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-4 text-center hover:border-slate-700 transition-colors">
                                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="file-upload" />
                                    <label htmlFor="file-upload" className="cursor-pointer">
                                        {previewUrl ? (
                                            <img src={previewUrl} className="max-h-48 mx-auto rounded-lg shadow-lg" alt="Preview" />
                                        ) : (
                                            <div className="py-8">
                                                <p className="text-slate-500">Click to upload image</p>
                                            </div>
                                        )}
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 2: Pinpoint on Map</label>
                                <div className="h-64 rounded-2xl overflow-hidden border border-slate-800" ref={mapRef} />
                            </div>

                            <div className="space-y-4">
                                <label className="block text-sm font-medium text-slate-400">Step 3: Set Difficulty</label>
                                <input name="difficulty" type="range" min="1" max="10" defaultValue="5" className="w-full accent-blue-500" />
                            </div>

                            {actionData?.error && <p className="text-red-400 text-sm">{actionData.error}</p>}
                            {actionData?.success && <p className="text-green-400 text-sm">{actionData.message}</p>}

                            <button
                                type="submit"
                                disabled={isSubmitting || !marker || !previewUrl}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg"
                            >
                                {isSubmitting ? "Saving..." : "Deploy Location"}
                            </button>
                        </Form>
                    ) : (
                        <div className="lg:col-span-2 bg-slate-900 p-8 rounded-3xl border border-slate-800 min-h-[600px] flex flex-col">
                            <div className="mb-4">
                                <h3 className="text-xl font-bold">Mark Identification Area</h3>
                                <p className="text-slate-500 text-sm">Draw a box over landmarks or text that confirm this location.</p>
                            </div>
                            <div className="flex-grow relative bg-black rounded-2xl overflow-hidden">
                                <EvidenceCanvas imageUrl={previewUrl} onBoxChange={setSelectedBox} />
                            </div>
                            <button
                                onClick={() => setEvidenceStep(false)}
                                className="mt-6 w-full py-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold"
                            >
                                Save Area and Return
                            </button>
                        </div>
                    )}

                    {!evidenceStep && previewUrl && (
                        <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 hidden lg:block">
                            <h3 className="text-slate-400 mb-4 uppercase text-xs tracking-widest font-bold">Live Preview</h3>
                            <div className="aspect-video rounded-2xl overflow-hidden relative group">
                                <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                                <div className="absolute bottom-4 left-4">
                                    <p className="text-xl font-bold">Mystery Location</p>
                                    <p className="text-sm text-slate-400">{marker?.lat.toFixed(4)}, {marker?.lng.toFixed(4)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
