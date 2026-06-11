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
        <div className="w-[25%] bg-[#0e1a14]/95 backdrop-blur-xl flex flex-col z-10 relative shadow-2xl border-l border-brass/10">
            <div className="p-6 border-b border-brass/10">
                <h3 className="text-xs font-bold uppercase tracking-widest text-stone mb-2 font-mono">Round Analysis</h3>
                <div className="flex justify-between items-end">
                    <div>
                        <span className="block text-3xl font-black text-cream font-heading">{participants.length}</span>
                        <span className="text-[10px] text-stone uppercase">Agents Deployed</span>
                    </div>
                    <div className="text-right">
                        <span className="block text-3xl font-black text-teal font-heading">
                            {officialEvidence?.length || 0}
                        </span>
                        <span className="text-[10px] text-stone uppercase">Intel Items</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone mb-2 font-mono">
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
                            <div key={teamId} className={`flex items-center justify-between p-4 rounded-sm border ${i === 0 ? 'bg-brass/10 border-brass/20' : 'bg-[#1a1a18]/50 border-brass/5'} hover:bg-brass/5 transition-colors cursor-pointer`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-sm flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-brass text-charcoal' : 'bg-[#1a1a18] text-cream'}`}>
                                        {i + 1}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`font-bold text-lg uppercase truncate max-w-[200px] ${teamId.includes('Red') ? 'text-rust' : teamId.includes('Blue') ? 'text-teal' : teamId.includes('Green') ? 'text-teal' : 'text-brass'}`}>{teamId}</span>
                                        {i === 0 && <span className="text-[10px] text-brass font-bold uppercase tracking-widest">Winning Squad</span>}
                                    </div>
                                </div>
                                <span className="font-mono text-2xl text-teal-light font-black">{score as number}</span>
                            </div>
                        ));
                    })()
                ) : (
                    participants.map((p: any, i: number) => (
                        <div key={i} className={`flex items-center justify-between p-4 rounded-sm border ${i === 0 ? 'bg-brass/10 border-brass/20' : 'bg-[#1a1a18]/50 border-brass/5'} hover:bg-brass/5 transition-colors cursor-pointer`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-sm flex items-center justify-center text-xl font-black ${i === 0 ? 'bg-brass text-charcoal' : 'bg-[#1a1a18] text-cream'}`}>
                                    {i + 1}
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-lg text-cream truncate max-w-[200px]">{p.display_name}</span>
                                    {i === 0 && <span className="text-[10px] text-brass font-bold uppercase tracking-widest">Current Leader</span>}
                                </div>
                            </div>
                            <span className="font-mono text-2xl text-teal-light font-black">{p.score}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Official Evidence List Toggle/View */}
            {officialEvidence?.length > 0 && (
                <div className="p-4 border-t border-brass/10 bg-[#0e1a14]/50">
                    <h4 className="text-[10px] uppercase font-bold text-brass tracking-wider mb-2 font-mono">Official Intel</h4>
                    <div className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar">
                        {officialEvidence.map((ev: any) => (
                            <div key={ev.id} className="text-[10px] text-stone border-l-2 border-brass/20 pl-2 hover:border-brass hover:text-cream transition-colors cursor-help group relative">
                                <span className="block truncate">{ev.description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="p-6 border-t border-brass/10 bg-[#0e1a14]">
                <button
                    onClick={() => actionFetcher.submit({ action: "NEXT_ROUND" }, { method: "post", action: `/api/room/${code}/action` })}
                    className="w-full py-4 bg-teal/80 hover:bg-teal text-cream text-lg font-black uppercase tracking-widest rounded-sm shadow-lg transition-all transform hover:scale-[1.02] font-mono border border-teal/50"
                >
                    Next Location →
                </button>
            </div>
        </div>
    );
}
