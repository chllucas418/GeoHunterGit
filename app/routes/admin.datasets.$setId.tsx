import { Form, Link, useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const setId = params.setId;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Fetch Set Details
    const set = await db.prepare("SELECT * FROM map_sets WHERE id = ?").bind(setId).first<any>();
    if (!set) throw new Response("Not Found", { status: 404 });

    // Fetch Set Items (Locations in this set)
    const { results: items } = await db.prepare(
        `SELECT l.id, l.lat, l.lng, l.difficulty_rating, msi.order_index 
         FROM map_set_items msi
         JOIN locations l ON msi.location_id = l.id
         WHERE msi.set_id = ?
         ORDER BY msi.order_index ASC`
    ).bind(setId).all<any>();

    // Fetch All Locations (Available to add)
    // Optimization: Exclude ones already in set, or handle in UI
    const { results: allLocations } = await db.prepare(
        "SELECT id, lat, lng, difficulty_rating FROM locations ORDER BY created_at DESC"
    ).all<any>();

    return { set, items, allLocations };
}

export async function action({ request, params, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const setId = params.setId;
    const formData = await request.formData();
    const intent = formData.get("intent");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "add") {
        const locId = formData.get("locId") as string;
        // Check if exists
        const exists = await db.prepare("SELECT 1 FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(setId, locId).first();
        if (exists) return { error: "Already in set" };

        // Get max order
        const max = await db.prepare("SELECT MAX(order_index) as m FROM map_set_items WHERE set_id = ?").bind(setId).first<any>();
        const nextOrder = (max?.m || 0) + 1;

        await db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)")
            .bind(setId, locId, nextOrder).run();
        return { success: true };
    }

    if (intent === "remove") {
        const locId = formData.get("locId") as string;
        await db.prepare("DELETE FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(setId, locId).run();
        return { success: true };
    }

    return null;
}

export default function DatasetEditor() {
    const { set, items, allLocations } = useLoaderData() as any;
    const fetcher = useFetcher();

    // Derive available locations (All - In Set)
    const existingIds = new Set(items.map((i: any) => i.id));
    const available = allLocations.filter((l: any) => !existingIds.has(l.id));

    return (
        <div className="min-h-screen p-6 md:p-12 relative z-10 bg-slate-950 text-white">
            <div className="max-w-7xl mx-auto space-y-8">
                <header>
                    <Link to="/admin/datasets" className="text-slate-500 hover:text-white text-xs uppercase tracking-widest font-bold mb-4 inline-block transition-colors">
                        ← Back to Registry
                    </Link>
                    <h1 className="text-4xl font-black text-white tracking-tighter mb-2">{set.name}</h1>
                    <p className="text-slate-400">{set.description}</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {/* LEFT: Current Items */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-white/10">
                            <h2 className="text-lg font-black uppercase tracking-widest text-emerald-400">Included Assets ({items.length})</h2>
                        </div>

                        <div className="space-y-3">
                            {items.length === 0 && <p className="text-slate-500 italic">No locations in this set yet.</p>}
                            {items.map((item: any, idx: number) => (
                                <div key={item.id} className="glass-panel p-4 rounded-xl border border-white/10 flex items-center gap-4 group">
                                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold text-xs">
                                        {idx + 1}
                                    </div>
                                    <img src={`/resources/image/${item.id}`} className="w-12 h-12 rounded-lg object-cover bg-slate-800" />
                                    <div className="flex-1">
                                        <div className="font-mono text-xs text-slate-300">ID: {item.id.slice(0, 8)}</div>
                                        <div className="text-[10px] text-slate-500">Diff: {item.difficulty_rating.toFixed(1)}</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const fd = new FormData();
                                            fd.append("intent", "remove");
                                            fd.append("locId", item.id);
                                            fetcher.submit(fd, { method: "post" });
                                        }}
                                        className="text-slate-500 hover:text-red-400 transition-colors p-2"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RIGHT: Available Items */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-white/10">
                            <h2 className="text-lg font-black uppercase tracking-widest text-slate-400">Available ({available.length})</h2>
                        </div>

                        <div className="grid grid-cols-1 gap-3 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
                            {available.map((loc: any) => (
                                <div key={loc.id} className="glass-panel p-3 rounded-xl border border-white/5 flex items-center gap-4 opacity-60 hover:opacity-100 transition-opacity">
                                    <img src={`/resources/image/${loc.id}`} className="w-10 h-10 rounded-lg object-cover bg-slate-800" />
                                    <div className="flex-1">
                                        <div className="font-mono text-xs text-slate-300">ID: {loc.id.slice(0, 8)}</div>
                                        <div className="text-[10px] text-slate-500">Diff: {loc.difficulty_rating.toFixed(1)}</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const fd = new FormData();
                                            fd.append("intent", "add");
                                            fd.append("locId", loc.id);
                                            fetcher.submit(fd, { method: "post" });
                                        }}
                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase rounded-lg transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
