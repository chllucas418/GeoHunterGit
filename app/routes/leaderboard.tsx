import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const { results: topElo } = await db.prepare("SELECT display_name, current_elo, accuracy_avg FROM users ORDER BY current_elo DESC LIMIT 10").all<any>();
    const { results: topAccuracy } = await db.prepare("SELECT display_name, current_elo, accuracy_avg FROM users ORDER BY accuracy_avg DESC LIMIT 10").all<any>();

    return { topElo, topAccuracy };
}

export default function Leaderboard() {
    const { topElo, topAccuracy } = useLoaderData<typeof loader>();

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-12">
                <header className="text-center space-y-2">
                    <Link to="/" className="text-blue-400 hover:underline text-sm inline-block">← Back to Discovery</Link>
                    <h1 className="text-5xl font-black bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-600 bg-clip-text text-transparent">
                        Global Hall of Fame
                    </h1>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Elo Leaderboard */}
                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <span className="text-indigo-400">🏆</span> Elo Masters
                            </h2>
                        </div>
                        <div className="space-y-3">
                            {topElo.map((u: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-800/50">
                                    <div className="flex items-center gap-4">
                                        <span className="text-slate-600 font-black w-6">{i + 1}.</span>
                                        <span className="font-bold">{u.display_name || "Anonymous Agent"}</span>
                                    </div>
                                    <span className="font-black text-indigo-400">{Math.round(u.current_elo)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Accuracy Leaderboard */}
                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <span className="text-purple-400">🎯</span> Accuracy Titans
                            </h2>
                        </div>
                        <div className="space-y-3">
                            {topAccuracy.map((u: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-800/50">
                                    <div className="flex items-center gap-4">
                                        <span className="text-slate-600 font-black w-6">{i + 1}.</span>
                                        <span className="font-bold">{u.display_name || "Anonymous Agent"}</span>
                                    </div>
                                    <span className="font-black text-purple-400">{Math.round(u.accuracy_avg * 100)}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
