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
    const { topElo, topAccuracy } = useLoaderData() as any;

    const getRankIcon = (index: number) => {
        if (index === 0) return "👑";
        if (index === 1) return "🥈";
        if (index === 2) return "🥉";
        return `#${index + 1}`;
    };

    const getRankStyle = (index: number) => {
        if (index === 0) return "text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]";
        if (index === 1) return "text-slate-300 drop-shadow-[0_0_10px_rgba(203,213,225,0.5)]";
        if (index === 2) return "text-orange-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)]";
        return "text-slate-500";
    };

    return (
        <div className="min-h-screen p-8 relative z-10">
            <div className="max-w-6xl mx-auto space-y-12">
                <header className="text-center space-y-4">
                    <Link to="/" className="px-4 py-2 rounded-full glass-panel text-blue-400 hover:text-white hover:bg-white/10 text-xs font-bold uppercase tracking-widest inline-block transition-all hover:scale-105">
                        ← Mission Control
                    </Link>
                    <div className="relative inline-block">
                        <div className="absolute inset-0 bg-blue-500/20 blur-[60px] rounded-full animate-pulse" />
                        <h1 className="relative text-6xl md:text-7xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white drop-shadow-lg">
                            HALL OF FAME
                        </h1>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Elo Leaderboard */}
                    <div className="glass-panel p-8 rounded-[2.5rem] relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] group-hover:bg-indigo-500/20 transition-all duration-700" />

                        <div className="flex items-center gap-4 mb-8 border-b border-white/5 pb-4 relative z-10">
                            <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center text-2xl border border-indigo-500/30 shadow-lg shadow-indigo-500/20">
                                🏆
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-wide text-white">Elite Operatives</h2>
                                <p className="text-xs text-indigo-300 font-mono">Highest Rated Agents</p>
                            </div>
                        </div>

                        <div className="space-y-3 relative z-10">
                            {topElo.map((u: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-4 rounded-2xl glass-card border-none hover:bg-white/10 transition-colors group/item">
                                    <div className="flex items-center gap-6">
                                        <span className={`text-xl font-black w-8 text-center ${getRankStyle(i)}`}>
                                            {getRankIcon(i)}
                                        </span>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-white group-hover/item:text-indigo-300 transition-colors">{u.display_name || `Agent ${u.id?.substr(0, 4)}`}</span>
                                            {i === 0 && <span className="text-[9px] uppercase font-bold text-yellow-400 tracking-wider">Current Champion</span>}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="font-black text-2xl text-white tracking-tight">{Math.round(u.current_elo)}</span>
                                        <span className="text-[10px] text-white/40 font-bold uppercase">Elo Rating</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Accuracy Leaderboard */}
                    <div className="glass-panel p-8 rounded-[2.5rem] relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px] group-hover:bg-purple-500/20 transition-all duration-700" />

                        <div className="flex items-center gap-4 mb-8 border-b border-white/5 pb-4 relative z-10">
                            <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-2xl border border-purple-500/30 shadow-lg shadow-purple-500/20">
                                🎯
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-wide text-white">Sharpshooters</h2>
                                <p className="text-xs text-purple-300 font-mono">Highest Precision Rating</p>
                            </div>
                        </div>

                        <div className="space-y-3 relative z-10">
                            {topAccuracy.map((u: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-4 rounded-2xl glass-card border-none hover:bg-white/10 transition-colors group/item">
                                    <div className="flex items-center gap-6">
                                        <span className={`text-xl font-black w-8 text-center ${getRankStyle(i)}`}>
                                            {getRankIcon(i)}
                                        </span>
                                        <div>
                                            <span className="font-bold text-white group-hover/item:text-purple-300 transition-colors">{u.display_name || "Unknown Agent"}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="font-black text-2xl text-white tracking-tight">{Math.round(u.accuracy_avg * 100)}%</span>
                                        <span className="text-[10px] text-white/40 font-bold uppercase">Precision</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
