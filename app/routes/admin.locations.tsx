import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";
import { useLoaderData, useFetcher, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const { results: locations } = await db.prepare("SELECT * FROM locations ORDER BY created_at DESC").all<any>();
    return { locations };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const locId = formData.get("locId") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "delete") {
        await db.prepare("DELETE FROM game_sessions WHERE location_id = ?").bind(locId).run();
        await db.prepare("DELETE FROM locations WHERE id = ?").bind(locId).run();
        return { success: true };
    }

    if (intent === "edit") {
        const lat = parseFloat(formData.get("lat") as string);
        const lng = parseFloat(formData.get("lng") as string);
        const diff = parseFloat(formData.get("diff") as string);
        const quality = parseInt(formData.get("quality") as string);

        await db.prepare("UPDATE locations SET lat = ?, lng = ?, difficulty_rating = ?, quality_score = ? WHERE id = ?")
            .bind(lat, lng, diff, quality, locId).run();
        return { success: true };
    }

    return null;
}

export default function AdminLocations() {
    const { locations } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back</Link>
                        <h1 className="text-3xl font-black">Admin: Location Management</h1>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {locations.map((loc: any) => (
                        <div key={loc.id} className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col hover:border-blue-500/50 transition-all group">
                            <div className="aspect-video relative">
                                <img src={loc.image_url} className="w-full h-full object-cover" alt="Location" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 p-4">
                                    <p className="text-xs font-mono text-slate-400">{loc.id}</p>
                                </div>
                            </div>
                            <div className="p-6 space-y-4 flex-grow">
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                    <div>
                                        <p className="text-slate-500 uppercase font-bold">Difficulty</p>
                                        <p className="text-blue-400 font-black">{loc.difficulty_rating.toFixed(1)}</p>
                                    </div>
                                    <div>
                                        <p className="text-slate-500 uppercase font-bold">Quality</p>
                                        <p className="text-purple-400 font-black">{loc.quality_score}%</p>
                                    </div>
                                </div>
                                <div className="pt-4 flex items-center justify-between gap-2">
                                    <button
                                        onClick={() => {
                                            const newLat = prompt("New Lat:", loc.lat);
                                            const newLng = prompt("New Lng:", loc.lng);
                                            if (newLat && newLng) {
                                                const fd = new FormData();
                                                fd.append("intent", "edit");
                                                fd.append("locId", loc.id);
                                                fd.append("lat", newLat);
                                                fd.append("lng", newLng);
                                                fd.append("diff", loc.difficulty_rating.toString());
                                                fd.append("quality", loc.quality_score.toString());
                                                fetcher.submit(fd, { method: "post" });
                                            }
                                        }}
                                        className="flex-grow py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold transition-colors"
                                    >
                                        Quick Edit
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (confirm("Delete this location permanently?")) {
                                                const fd = new FormData();
                                                fd.append("intent", "delete");
                                                fd.append("locId", loc.id);
                                                fetcher.submit(fd, { method: "post" });
                                            }
                                        }}
                                        className="px-4 py-2 bg-red-900/20 text-red-400 hover:bg-red-900/40 rounded-xl text-xs font-bold transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
