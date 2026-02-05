import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const userId = params.userId;

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();

    if (!user) {
        throw new Response("Agent Not Found", { status: 404 });
    }

    const { results: history } = await db.prepare(`
        SELECT 
            gs.id, 
            gs.score, 
            gs.timestamp, 
            gs.location_id,
            l.image_url,
            gs.ai_feedback
        FROM game_sessions gs
        JOIN locations l ON gs.location_id = l.id
        WHERE gs.user_id = ?
        ORDER BY gs.timestamp DESC
        LIMIT 50
    `).bind(userId).all<any>();

    return { user, history };
}

export default function AdminUserDetails() {
    const { user, history } = useLoaderData() as any;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-6 md:p-12 relative">
            <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-900/20 to-transparent pointer-events-none" />

            <div className="max-w-5xl mx-auto space-y-8 relative z-10">
                <Link to="/admin/users" className="glass-panel px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest text-slate-300 hover:text-white hover:bg-white/10 transition-all inline-flex items-center gap-2">
                    ← Return to Registry
                </Link>

                <div className="glass-panel p-8 rounded-[2rem] flex flex-col md:flex-row items-center gap-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px]" />

                    <div className="w-24 h-24 rounded-2xl bg-slate-800 flex items-center justify-center text-4xl border border-slate-700 shadow-xl">
                        {user.display_name?.[0]?.toUpperCase() || "?"}
                    </div>

                    <div className="flex-1 text-center md:text-left space-y-2">
                        <h1 className="text-3xl md:text-4xl font-black text-white">{user.display_name}</h1>
                        <p className="font-mono text-slate-400 text-sm">{user.email} • ID: {user.id}</p>
                        <div className="flex items-center gap-2 justify-center md:justify-start">
                            <div className="px-3 py-1 rounded bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                                Elo {Math.round(user.current_elo)}
                            </div>
                            <div className="px-3 py-1 rounded bg-green-500/20 text-green-300 text-xs font-bold border border-green-500/30">
                                Accuracy {Math.round((user.accuracy_avg || 0) * 100)}%
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-center">
                        <div className="p-4 bg-slate-900/50 rounded-2xl border border-white/5">
                            <p className="text-2xl font-black text-white">{user.total_games}</p>
                            <p className="text-[10px] uppercase font-bold text-slate-500">Missions</p>
                        </div>
                        <div className="p-4 bg-slate-900/50 rounded-2xl border border-white/5">
                            <p className="text-2xl font-black text-white">{history.reduce((acc: number, h: any) => acc + (h.score || 0), 0)}</p>
                            <p className="text-[10px] uppercase font-bold text-slate-500">Total Score</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-xl font-bold px-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        Mission Logs
                    </h2>

                    {history.length === 0 ? (
                        <div className="p-12 text-center text-slate-600 font-mono">
                            No mission data recorded.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {history.map((game: any) => {
                                let feedback;
                                try {
                                    feedback = typeof game.ai_feedback === 'string' ? JSON.parse(game.ai_feedback) : game.ai_feedback;
                                } catch (e) { feedback = {} }

                                return (
                                    <div key={game.id} className="glass-card p-4 rounded-2xl flex items-center justify-between group hover:bg-white/5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-12 rounded-lg bg-slate-800 overflow-hidden relative border border-white/10">
                                                <img src={game.image_url} alt="Target" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-white text-sm">LOC-{game.location_id.substring(4, 8).toUpperCase()}</p>
                                                <p className="text-xs text-slate-500 font-mono">{new Date(game.timestamp).toLocaleDateString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1">
                                            <div className="text-xl font-black text-white">{game.score} <span className="text-xs font-normal text-slate-500">PTS</span></div>
                                            {feedback?.validity !== undefined && (
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${feedback.validity > 0.5 ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                                                    {feedback.validity > 0.5 ? "Verified" : "Failed"}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
