import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { useLoaderData, Link, useFetcher, Form } from "react-router";
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
        <div className="min-h-screen p-6 md:p-12 relative z-10">
            <div className="max-w-4xl mx-auto space-y-8">

                {/* --- HOLOGRAPHIC HEADER --- */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 glass-panel p-8 rounded-[3rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-[80px] group-hover:bg-blue-500/30 transition-all duration-700" />

                    <div className="flex items-center gap-6 relative z-10">
                        <div className="relative">
                            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-white/20 shadow-2xl flex items-center justify-center text-4xl bg-black/50 backdrop-blur-md">
                                {user.profile_picture_url ? (
                                    <img src={user.profile_picture_url} className="w-full h-full object-cover" alt="Profile" />
                                ) : (
                                    <span className="text-white/40 font-black">{user.display_name?.[0]?.toUpperCase() || "A"}</span>
                                )}
                            </div>
                            <div className="absolute -bottom-2 -right-2 bg-emerald-500/20 backdrop-blur text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg">
                                Active
                            </div>
                        </div>
                        <div>
                            <Link to="/" className="text-blue-300/80 hover:text-white text-xs uppercase tracking-widest font-bold mb-2 inline-block transition-colors">
                                ← Return to Command
                            </Link>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight text-glow">
                                {user.display_name || "Anonymous Agent"}
                            </h1>
                            <p className="text-sm font-mono text-white/40">{user.email}</p>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="relative z-10 px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all backdrop-blur-md hover:scale-105"
                    >
                        {isEditing ? "Cancel Upload" : "Modify ID"}
                    </button>
                </header>

                {isEditing && (
                    <fetcher.Form method="post" className="glass-panel p-8 rounded-[2.5rem] space-y-6 animate-slide-in border border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.1)]">
                        <input type="hidden" name="intent" value="updateProfile" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <label className="text-[10px] uppercase font-black tracking-widest text-blue-300">New Codename</label>
                                <input
                                    name="displayName"
                                    defaultValue={user.display_name}
                                    placeholder="Agent Name"
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] uppercase font-black tracking-widest text-blue-300">Avatar Frequency (URL)</label>
                                <input
                                    name="profilePic"
                                    defaultValue={user.profile_picture_url}
                                    placeholder="https://..."
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all"
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-[0.98]"
                        >
                            {isLoading ? "UPLOADING DATA..." : "CONFIRM IDENTITY UPDATE"}
                        </button>
                    </fetcher.Form>
                )}

                {/* --- STAT CRYSTALS --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="glass-card p-8 rounded-[2.5rem] flex flex-col items-center justify-center text-center group">
                        <div className="mb-4 p-4 rounded-full bg-blue-500/10 text-3xl group-hover:scale-110 transition-transform duration-500">🌍</div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/60 mb-1">Global Ranking</p>
                        <p className="text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">#{rank}</p>
                    </div>
                    <div className="glass-card p-8 rounded-[2.5rem] flex flex-col items-center justify-center text-center group">
                        <div className="mb-4 p-4 rounded-full bg-purple-500/10 text-3xl group-hover:scale-110 transition-transform duration-500">⚡</div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-purple-200/60 mb-1">Elo Rating</p>
                        <p className="text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">{Math.round(user.current_elo)}</p>
                    </div>
                    <div className="glass-card p-8 rounded-[2.5rem] flex flex-col items-center justify-center text-center group">
                        <div className="mb-4 p-4 rounded-full bg-emerald-500/10 text-3xl group-hover:scale-110 transition-transform duration-500">🎯</div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200/60 mb-1">Precision</p>
                        <p className="text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]">{Math.round((user.accuracy_avg || 0) * 100)}%</p>
                    </div>
                </div>

                {/* --- HISTORY LOGS --- */}
                <section className="space-y-6">
                    <h2 className="text-sm font-black text-white/40 uppercase tracking-[0.3em] ml-4">Tactical History</h2>
                    <div className="space-y-4">
                        {recentGames.length === 0 ? (
                            <div className="glass-panel py-16 text-center text-white/30 rounded-[2rem] border-dashed border-white/5">
                                NO MISSION DATA FOUND
                            </div>
                        ) : (
                            recentGames.map((game: any) => (
                                <div key={game.id} className="glass-panel p-4 rounded-[2rem] flex items-center gap-6 hover:bg-white/5 transition-colors group">
                                    <div className="relative w-20 h-20 rounded-2xl overflow-hidden glass-card flex-shrink-0">
                                        <img src={game.image_url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500" alt="Location" />
                                    </div>
                                    <div className="flex-grow">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-2xl font-bold text-white leading-none">{game.score}</span>
                                            <span className={`text-[9px] px-2 py-1 rounded-lg font-black uppercase tracking-wider ${game.score > 4000 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'
                                                }`}>
                                                {game.score > 4000 ? "Elite Perf." : "Completed"}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-white/40 font-mono uppercase">{new Date(game.timestamp).toLocaleString()}</p>
                                    </div>
                                    <div className="text-right pr-4">
                                        <p className={`text-xl font-black ${game.score > 2000 ? 'text-blue-400' : 'text-red-400'}`}>
                                            {game.score > 2000 ? '+' : ''}{Math.round((game.score - 2000) / 10)}
                                        </p>
                                        <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest">Elo</p>
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
