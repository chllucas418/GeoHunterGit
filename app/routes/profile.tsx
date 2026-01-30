import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { useLoaderData, Link, useFetcher } from "react-router";
import { useState } from "react";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const userId = await requireUser(request);
    if (userId === "developer-admin") {
        throw new Response(null, { status: 302, headers: { Location: "/" } });
    }
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Fetch user stats
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();

    // Calculate ranking (Elo)
    const { count } = await db.prepare("SELECT COUNT(*) as count FROM users WHERE current_elo > ?").bind(user.current_elo).first<any>();
    const rank = count + 1;

    // Fetch recent games
    const { results: recentGames } = await db.prepare(`
        SELECT gs.*, l.image_url 
        FROM game_sessions gs 
        JOIN locations l ON gs.location_id = l.id 
        WHERE gs.user_id = ? 
        ORDER BY gs.timestamp DESC 
        LIMIT 5
    `).bind(userId).all<any>();

    return { user, rank, recentGames };
}

export async function action({ request, context }: ActionFunctionArgs) {
    const userId = await requireUser(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "updateProfile") {
        const displayName = formData.get("displayName") as string;
        const profilePic = formData.get("profilePic") as string;
        await db.prepare("UPDATE users SET display_name = ?, profile_picture_url = ? WHERE id = ?")
            .bind(displayName, profilePic, userId).run();
        return { success: true };
    }

    return null;
}

export default function Profile() {
    const { user, rank, recentGames } = useLoaderData() as any;
    const fetcher = useFetcher();
    const [isEditing, setIsEditing] = useState(false);

    const isLoading = fetcher.state !== "idle";

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-6">
                        <div className="relative">
                            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl overflow-hidden border-2 border-slate-800 shadow-2xl flex items-center justify-center text-4xl">
                                {user.profile_picture_url ? (
                                    <img src={user.profile_picture_url} className="w-full h-full object-cover" alt="Profile" />
                                ) : (
                                    user.display_name?.[0]?.toUpperCase() || "A"
                                )}
                            </div>
                        </div>
                        <div>
                            <Link to="/" className="text-blue-400 hover:underline text-sm mb-1 inline-block">← Back to Field</Link>
                            <h1 className="text-4xl font-black bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                                {user.display_name || "Anonymous Agent"}
                            </h1>
                            <p className="text-slate-500 font-mono text-xs">{user.email}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="px-6 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 transition-colors text-sm font-bold"
                    >
                        {isEditing ? "Cancel" : "Edit Identity"}
                    </button>
                </header>

                {isEditing && (
                    <fetcher.Form method="post" className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl space-y-6 animate-slide-in">
                        <input type="hidden" name="intent" value="updateProfile" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-bold text-slate-500">Public Codename</label>
                                <input
                                    name="displayName"
                                    defaultValue={user.display_name}
                                    placeholder="Agent Name"
                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-bold text-slate-500">Signal (Avatar URL)</label>
                                <input
                                    name="profilePic"
                                    defaultValue={user.profile_picture_url}
                                    placeholder="https://..."
                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg active:scale-95"
                        >
                            {isLoading ? "Broadcasting..." : "Save Identity Changes"}
                        </button>
                    </fetcher.Form>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl space-y-2 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 text-4xl group-hover:scale-110 transition-transform">🌍</div>
                        <p className="text-slate-500 uppercase text-[10px] font-black tracking-[0.2em]">Global Rank</p>
                        <p className="text-4xl font-black text-blue-400">#{rank}</p>
                    </div>
                    <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl space-y-2 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 text-4xl group-hover:scale-110 transition-transform">⚡</div>
                        <p className="text-slate-500 uppercase text-[10px] font-black tracking-[0.2em]">Current Elo</p>
                        <p className="text-4xl font-black text-indigo-400">{Math.round(user.current_elo)}</p>
                    </div>
                    <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl space-y-2 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 text-4xl group-hover:scale-110 transition-transform">🎯</div>
                        <p className="text-slate-500 uppercase text-[10px] font-black tracking-[0.2em]">Accuracy</p>
                        <p className="text-4xl font-black text-purple-400">{Math.round((user.accuracy_avg || 0) * 100)}%</p>
                    </div>
                </div>

                <section className="space-y-6">
                    <h2 className="text-2xl font-black text-slate-400 uppercase tracking-widest text-sm">Recent Tactical Logs</h2>
                    <div className="space-y-4">
                        {recentGames.length === 0 ? (
                            <div className="text-center py-12 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800 text-slate-600">
                                No tactical data available. Start a hunt to populate your logs.
                            </div>
                        ) : (
                            recentGames.map((game: any) => (
                                <div key={game.id} className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex items-center gap-6 hover:bg-slate-900 transition-colors group">
                                    <div className="relative w-24 h-16 rounded-2xl overflow-hidden border border-slate-800 flex-shrink-0">
                                        <img src={game.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform" alt="Location" />
                                    </div>
                                    <div className="flex-grow">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="text-lg font-black text-slate-100">Score: {game.score}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${game.score > 4000 ? 'bg-green-500/10 text-green-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                {game.score > 4000 ? "OUTSTANDING" : "COMPLETED"}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 font-mono">{new Date(game.timestamp).toLocaleString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-2xl font-black ${game.score > 2000 ? 'text-indigo-400' : 'text-red-400'}`}>
                                            {game.score > 2000 ? '+' : ''}{Math.round((game.score - 2000) / 10)}
                                        </p>
                                        <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Elo Shift</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
