import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { useLoaderData, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const userId = await requireUser(request);
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

export default function Profile() {
    const { user, rank, recentGames } = useLoaderData() as any;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back</Link>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                            Agent Profile
                        </h1>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-2">
                        <p className="text-slate-500 uppercase text-xs font-bold tracking-widest">Global Rank</p>
                        <p className="text-3xl font-black text-blue-400">#{rank}</p>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-2">
                        <p className="text-slate-500 uppercase text-xs font-bold tracking-widest">Current Elo</p>
                        <p className="text-3xl font-black text-indigo-400">{Math.round(user.current_elo)}</p>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-2">
                        <p className="text-slate-500 uppercase text-xs font-bold tracking-widest">Accuracy</p>
                        <p className="text-3xl font-black text-purple-400">{Math.round(user.accuracy_avg * 100)}%</p>
                    </div>
                </div>

                <section className="space-y-4">
                    <h2 className="text-xl font-bold">Recent Field Reports</h2>
                    <div className="space-y-4">
                        {recentGames.map((game: any) => (
                            <div key={game.id} className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800 flex items-center gap-4">
                                <img src={game.image_url} className="w-16 h-16 rounded-xl object-cover" alt="Location" />
                                <div className="flex-grow">
                                    <p className="font-bold text-slate-200">Score: {game.score}</p>
                                    <p className="text-xs text-slate-500">{new Date(game.timestamp).toLocaleDateString()}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xl font-black text-slate-700">+{Math.round(game.score / 10)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
