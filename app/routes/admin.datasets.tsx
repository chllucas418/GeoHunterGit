import { Form, Link, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper, getUserId } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const { results: mapSets } = await db.prepare(
        `SELECT ms.*, COUNT(msi.location_id) as item_count 
         FROM map_sets ms 
         LEFT JOIN map_set_items msi ON ms.id = msi.set_id 
         GROUP BY ms.id 
         ORDER BY ms.created_at DESC`
    ).all<any>();

    return { mapSets };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const userId = await getUserId(request) as string;
    const formData = await request.formData();
    const intent = formData.get("intent");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "create") {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const id = crypto.randomUUID();

        if (!name) return { error: "Name is required" };

        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(id, name, description, userId).run();

        return { success: true };
    }

    if (intent === "delete") {
        const id = formData.get("id") as string;
        // Delete items first
        await db.prepare("DELETE FROM map_set_items WHERE set_id = ?").bind(id).run();
        // Delete set
        await db.prepare("DELETE FROM map_sets WHERE id = ?").bind(id).run();
        return { success: true };
    }

    return null;
}

export default function AdminDatasets() {
    const { mapSets } = useLoaderData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen p-6 md:p-12 relative z-10 bg-slate-950 text-white">
            <div className="max-w-6xl mx-auto space-y-12">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div>
                        <Link to="/admin" className="text-blue-300 hover:text-white text-xs uppercase tracking-widest font-bold mb-4 inline-block transition-colors">
                            ← Control Center
                        </Link>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter text-glow">
                            Dataset Registry
                        </h1>
                        <p className="text-blue-200/60 font-mono mt-2">Organize location assets into mission collections.</p>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                    {/* List Column */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="grid grid-cols-1 gap-4">
                            {mapSets.map((set: any) => (
                                <div key={set.id} className="glass-panel p-6 rounded-2xl border border-white/10 flex items-center justify-between group hover:bg-white/5 transition-colors">
                                    <div>
                                        <h3 className="text-xl font-black text-white mb-1 group-hover:text-sky-300 transition-colors">{set.name}</h3>
                                        <p className="text-sm text-slate-400 mb-2">{set.description || "No description provided."}</p>
                                        <span className="inline-block px-2 py-1 bg-white/5 rounded-md text-[10px] uppercase font-bold text-slate-500 border border-white/5">
                                            {set.item_count} Locations
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Link
                                            to={`/admin/datasets/${set.id}`}
                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                        >
                                            Manage
                                        </Link>
                                        <Form method="post" onSubmit={(e) => !confirm("Delete this dataset?") && e.preventDefault()}>
                                            <input type="hidden" name="intent" value="delete" />
                                            <input type="hidden" name="id" value={set.id} />
                                            <button
                                                disabled={isSubmitting}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-all font-bold"
                                            >
                                                ✕
                                            </button>
                                        </Form>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Create Column */}
                    <div className="lg:col-span-1">
                        <div className="glass-card p-8 rounded-3xl sticky top-8">
                            <h2 className="text-xl font-black text-white mb-6 uppercase tracking-widest">Create New Set</h2>
                            <Form method="post" className="space-y-6">
                                <input type="hidden" name="intent" value="create" />
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-bold text-blue-300 ml-2">Display Name</label>
                                    <input
                                        name="name"
                                        required
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none"
                                        placeholder="e.g. Asia Hard Mode"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-bold text-blue-300 ml-2">Description</label>
                                    <textarea
                                        name="description"
                                        rows={3}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none resize-none"
                                        placeholder="Brief briefing..."
                                    />
                                </div>
                                <button
                                    disabled={isSubmitting}
                                    className="w-full py-4 bg-white text-black font-black uppercase tracking-widest rounded-xl hover:bg-blue-50 transition-all shadow-lg active:scale-[0.98]"
                                >
                                    {isSubmitting ? "Processing..." : "Create Collection"}
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
