import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";
import { useLoaderData, useFetcher, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const { results: users } = await db.prepare("SELECT id, email, display_name, current_elo, total_games, accuracy_avg FROM users ORDER BY created_at DESC").all<any>();
    return { users };
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
        const elo = parseInt(formData.get("elo") as string);
        await db.prepare("UPDATE users SET display_name = ?, current_elo = ? WHERE id = ?").bind(displayName, elo, userId).run();
        return { success: true };
    }

    return null;
}

export default function AdminUsers() {
    const { users } = useLoaderData() as any;
    const fetcher = useFetcher();

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back to Dashboard</Link>
                        <h1 className="text-4xl font-black bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Agent Registry
                        </h1>
                    </div>
                    <div className="bg-slate-900 px-4 py-2 rounded-2xl border border-slate-800 text-sm font-bold text-slate-400">
                        {users.length} Active Agents
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {users.map((user: any) => (
                        <div key={user.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6 hover:border-slate-700 transition-all group">
                            <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-xl font-bold group-hover:text-blue-400 transition-colors">
                                        {user.display_name || "Anonymous Agent"}
                                    </h2>
                                    <p className="text-xs text-slate-500 font-mono">{user.email}</p>
                                </div>
                                <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-slate-500 font-bold border border-slate-700">
                                    {user.display_name?.[0]?.toUpperCase() || "?"}
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 border-y border-slate-800 py-4">
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Elo</p>
                                    <p className="text-lg font-black text-indigo-400">{Math.round(user.current_elo)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Accuracy</p>
                                    <p className="text-lg font-black text-purple-400">{Math.round((user.accuracy_avg || 0) * 100)}%</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Games</p>
                                    <p className="text-lg font-black text-slate-300">{user.total_games}</p>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        const newName = prompt("New display name:", user.display_name);
                                        if (newName) {
                                            const fd = new FormData();
                                            fd.append("intent", "edit");
                                            fd.append("userId", user.id);
                                            fd.append("displayName", newName);
                                            fd.append("elo", user.current_id === "developer-admin" ? "9999" : user.current_elo.toString());
                                            fetcher.submit(fd, { method: "post" });
                                        }
                                    }}
                                    className="flex-grow py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-700 hover:border-blue-500/30"
                                >
                                    Edit Agent
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm("Permanently strip this agent of their identity?")) {
                                            const fd = new FormData();
                                            fd.append("intent", "delete");
                                            fd.append("userId", user.id);
                                            fetcher.submit(fd, { method: "post" });
                                        }
                                    }}
                                    className="px-4 py-3 bg-red-900/10 text-red-400 hover:bg-red-900/20 rounded-xl transition-all border border-red-900/20 hover:border-red-900/40"
                                    title="Delete User"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
