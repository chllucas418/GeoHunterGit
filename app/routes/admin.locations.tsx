import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";
import { useLoaderData, useFetcher, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 12;
    const offset = (page - 1) * limit;

    const { results: locations } = await db.prepare("SELECT * FROM locations ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all<any>();

    const countResult = await db.prepare("SELECT COUNT(*) as count FROM locations").first<any>();
    const totalLocations = countResult.count;
    const totalPages = Math.ceil(totalLocations / limit);

    return { locations, page, totalPages };
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
    const { locations, page, totalPages } = useLoaderData() as any;
    const fetcher = useFetcher();

    return (
        <div className="min-h-screen p-6 md:p-12 relative z-10">
            <div className="max-w-7xl mx-auto space-y-12">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-300 hover:text-white text-xs uppercase tracking-widest font-bold mb-4 inline-block transition-colors">
                            ← Control Center
                        </Link>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter text-glow">
                            Target Logistics
                        </h1>
                        <p className="text-blue-200/60 font-mono mt-2">Manage deployment zones and intelligence assets.</p>
                    </div>
                    <Link
                        to="/admin/add-location"
                        className="px-8 py-3 bg-blue-500 hover:bg-blue-400 text-white font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:scale-105"
                    >
                        + Deploy Asset
                    </Link>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    {locations.map((loc: any) => (
                        <div key={loc.id} className="glass-card rounded-[2rem] overflow-hidden flex flex-col group relative">
                            {/* Image Header */}
                            <div className="h-48 relative overflow-hidden">
                                <img
                                    src={loc.image_url}
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                    alt="Location Asset"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                                <div className="absolute bottom-4 left-4 font-mono text-xs text-blue-300">
                                    ID: {loc.id.substring(0, 8)}...
                                </div>
                                <div className={`absolute top-4 right-4 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider backdrop-blur-md border border-white/10 ${loc.difficulty_rating > 7 ? 'bg-red-500/20 text-red-200' : 'bg-emerald-500/20 text-emerald-200'
                                    }`}>
                                    rating: {loc.difficulty_rating.toFixed(2)}
                                </div>
                            </div>

                            {/* Data Panel */}
                            <div className="p-6 space-y-6 flex-grow flex flex-col justify-between">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                                        <p className="text-[9px] uppercase font-bold text-white/40 mb-1">Signal Quality</p>
                                        <p className="text-2xl font-black text-white">{loc.quality_score}%</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                                        <p className="text-[9px] uppercase font-bold text-white/40 mb-1">Coordinates</p>
                                        <p className="text-xs font-mono text-white/60 truncate" title={`${loc.lat}, ${loc.lng}`}>
                                            {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <Link
                                        to={`/admin/add-location?id=${loc.id}`}
                                        className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-wider text-center text-white transition-colors border border-white/10"
                                    >
                                        Modify
                                    </Link>
                                    <button
                                        onClick={() => {
                                            if (confirm("WARNING: Confirm decommissioning of this asset? This cannot be undone.")) {
                                                const fd = new FormData();
                                                fd.append("intent", "delete");
                                                fd.append("locId", loc.id);
                                                fetcher.submit(fd, { method: "post" });
                                            }
                                        }}
                                        className="px-4 py-3 bg-red-500/10 hover:bg-red-500/30 text-red-400 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-red-500/20"
                                    >
                                        Purge
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Pagination Controls */}
                <div className="flex justify-center items-center gap-4 mt-8">
                    <Link
                        to={`?page=${Math.max(1, page - 1)}`}
                        className={`px-4 py-2 bg-slate-800 rounded-lg text-sm font-bold border border-slate-700 hover:bg-slate-700 transition ${page === 1 ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                        Previous
                    </Link>
                    <span className="text-sm font-mono text-slate-400">Page {page} of {totalPages}</span>
                    <Link
                        to={`?page=${Math.min(totalPages, page + 1)}`}
                        className={`px-4 py-2 bg-slate-800 rounded-lg text-sm font-bold border border-slate-700 hover:bg-slate-700 transition ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                        Next
                    </Link>
                </div>
            </div>
        </div>
    );
}
