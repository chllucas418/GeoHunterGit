import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";
import { useLoaderData, useFetcher, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 20;
    const offset = (page - 1) * limit;

    const { results: users } = await db.prepare("SELECT id, email, display_name, current_elo, total_games, accuracy_avg FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all<any>();

    const countResult = await db.prepare("SELECT COUNT(*) as count FROM users").first<any>();
    const totalUsers = countResult.count;
    const totalPages = Math.ceil(totalUsers / limit);

    return { users, page, totalPages, totalUsers };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const userId = formData.get("userId") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "delete") {
        await db.prepare("DELETE FROM game_sessions WHERE user_id = ?").bind(userId).run();
        await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
        return { success: true };
    }

    if (intent === "edit") {
        const displayName = formData.get("displayName") as string;
        // const elo = parseInt(formData.get("elo") as string); 
        // Allow editing logic expansion here
        await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, userId).run();
        return { success: true };
    }

    return null;
}

export default function AdminUsers() {
    const { users, page, totalPages, totalUsers } = useLoaderData() as any;
    const fetcher = useFetcher();

    return (
        <div className="min-h-screen p-6 md:p-12 relative z-10">
            <div className="max-w-7xl mx-auto space-y-12">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div>
                        <Link to="/" className="text-blue-300 hover:text-white text-xs uppercase tracking-widest font-bold mb-4 inline-block transition-colors">
                            ← Control Center
                        </Link>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter text-glow">
                            Agent Registry
                        </h1>
                        <p className="text-blue-200/60 font-mono mt-2">Database of active field operatives.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link to="/admin/create-teacher" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-2xl transition-all shadow-lg hover:shadow-blue-500/20">
                            + Provision Teacher
                        </Link>
                        <div className="glass-panel px-6 py-3 rounded-2xl border border-white/10 text-sm font-bold text-white/80 uppercase tracking-widest backdrop-blur-md">
                            {totalUsers} Active Agents
                        </div>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    {users.map((user: any) => (
                        <div key={user.id} className="glass-card p-8 rounded-[2rem] space-y-6 flex flex-col group hover:bg-white/5 relative overflow-hidden">
                            {/* Decorative Blur */}
                            <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/10 rounded-full blur-[50px] group-hover:bg-blue-500/20 transition-all duration-700" />

                            <div className="flex items-start justify-between relative z-10">
                                <div>
                                    <h2 className="text-xl font-black text-white group-hover:text-blue-300 transition-colors">
                                        {user.display_name || "Unknown Agent"}
                                    </h2>
                                    <p className="text-[10px] uppercase font-bold text-white/30 tracking-widest mt-1">ID: {user.id.substring(0, 8)}</p>
                                    <p className="text-xs text-white/50 font-mono mt-2">{user.email}</p>
                                </div>
                                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-lg font-black text-white/40 group-hover:text-white group-hover:bg-blue-500/20 transition-all">
                                    {user.display_name?.[0]?.toUpperCase() || "?"}
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-6 relative z-10">
                                <div className="text-center">
                                    <p className="text-[9px] uppercase font-bold text-white/30 mb-1">Elo</p>
                                    <p className="text-xl font-black text-indigo-300">{Math.round(user.current_elo)}</p>
                                </div>
                                <div className="text-center border-l border-white/5">
                                    <p className="text-[9px] uppercase font-bold text-white/30 mb-1">Precision</p>
                                    <p className="text-xl font-black text-purple-300">{Math.round((user.accuracy_avg || 0) * 100)}%</p>
                                </div>
                                <div className="text-center border-l border-white/5">
                                    <p className="text-[9px] uppercase font-bold text-white/30 mb-1">Missions</p>
                                    <p className="text-xl font-black text-emerald-300">{user.total_games}</p>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2 relative z-10">
                                <button
                                    onClick={() => {
                                        const newName = prompt("Enter new codename identity:", user.display_name);
                                        if (newName) {
                                            const fd = new FormData();
                                            fd.append("intent", "edit");
                                            fd.append("userId", user.id);
                                            fd.append("displayName", newName);
                                            fetcher.submit(fd, { method: "post" });
                                        }
                                    }}
                                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold uppercase tracking-wider text-white transition-all border border-white/10 hover:border-blue-500/30"
                                >
                                    Reassign
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm("CRITICAL: Confirm permanent deletion of this agent record?")) {
                                            const fd = new FormData();
                                            fd.append("intent", "delete");
                                            fd.append("userId", user.id);
                                            fetcher.submit(fd, { method: "post" });
                                        }
                                    }}
                                    className="px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-xl transition-all border border-red-500/20 hover:border-red-500/40"
                                    title="Revoke Clearance"
                                >
                                    ✕
                                </button>
                            </div>
                            <Link
                                to={`/admin/users/${user.id}`}
                                className="w-full py-3 mt-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 rounded-xl text-xs font-bold uppercase tracking-wider text-center transition-all border border-indigo-500/20 hover:border-indigo-500/40 block relative z-10"
                            >
                                View Service Record
                            </Link>
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
