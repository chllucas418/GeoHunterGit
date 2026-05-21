import { type FetcherWithComponents } from "react-router";

interface LiveLeaderboardProps {
    room: any;
    participants: any[];
    officialEvidence: any[];
    code: string;
    actionFetcher: FetcherWithComponents<any>;
}

export function LiveLeaderboard({ room, participants, officialEvidence, code, actionFetcher }: LiveLeaderboardProps) {
    return (
        <div className="w-[25%] bg-slate-900/95 backdrop-blur-xl flex flex-col z-10 relative shadow-2xl">
            <div className="p-6 border-b border-white/10">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Round Analysis</h3>
                <div className="flex justify-between items-end">
                    <div>
                        <span className="block text-3xl font-black text-white">{participants.length}</span>
                        <span className="text-[10px] text-slate-400 uppercase">Agents Deployed</span>
                    </div>
                    <div className="text-right">
                        <span className="block text-3xl font-black text-green-400">
                            {officialEvidence?.length || 0}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase">Intel Items</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">
                    Deployment Log {room.game_mode === 'teams' ? '(SQUAD SCORES)' : ''}
                </h3>

                {room.game_mode === 'teams' ? (
                    (() => {
                        // Aggregate scores by team
                        const teamScores = participants.reduce((acc: any, p: any) => {
                            if (p.team_id) {
                                acc[p.team_id] = (acc[p.team_id] || 0) + p.score;
                            }
                            return acc;
                        }, {});

                        const sortedTeams = Object.entries(teamScores).sort((a: any, b: any) => b[1] - a[1]);

                        return sortedTeams.map(([teamId, score], i) => (
                            <div key={teamId} className={`flex items-center justify-between p-4 rounded-xl border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-white/5 border-white/5'} hover:bg-white/10 transition-colors cursor-pointer`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-white'}`}>
                                        {i + 1}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`font-bold text-lg uppercase truncate max-w-[200px] ${teamId.includes('Red') ? 'text-red-400' : teamId.includes('Blue') ? 'text-blue-400' : teamId.includes('Green') ? 'text-green-400' : 'text-yellow-400'}`}>{teamId}</span>
                                        {i === 0 && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">Winning Squad</span>}
                                    </div>
                                </div>
                                <span className="font-mono text-2xl text-blue-300 font-black">{score as number}</span>
                            </div>
                        ));
                    })()
                ) : (
                    participants.map((p: any, i: number) => (
                        <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-white/5 border-white/5'} hover:bg-white/10 transition-colors cursor-pointer`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-white'}`}>
                                    {i + 1}
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-lg text-white truncate max-w-[200px]">{p.display_name}</span>
                                    {i === 0 && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">Current Leader</span>}
                                </div>
                            </div>
                            <span className="font-mono text-2xl text-blue-300 font-black">{p.score}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Official Evidence List Toggle/View */}
            {officialEvidence?.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-slate-900/50">
                    <h4 className="text-[10px] uppercase font-bold text-yellow-500 tracking-wider mb-2">Official Intel</h4>
                    <div className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar">
                        {officialEvidence.map((ev: any) => (
                            <div key={ev.id} className="text-[10px] text-slate-400 border-l-2 border-yellow-500/20 pl-2 hover:border-yellow-500 hover:text-white transition-colors cursor-help group relative">
                                <span className="block truncate">{ev.description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="p-6 border-t border-white/10 bg-slate-900">
                <button
                    onClick={() => actionFetcher.submit({ action: "NEXT_ROUND" }, { method: "post", action: `/api/room/${code}/action` })}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-black uppercase tracking-widest rounded-xl shadow-lg transition-all transform hover:scale-[1.02]"
                >
                    Next Location →
                </button>
            </div>
        </div>
    );
}
