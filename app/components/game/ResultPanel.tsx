export function ResultPanel({ result, layoutMode, room, currentRound, evidenceList }: any) {
    if (!result || layoutMode !== "result") return null;

    return (
        <div className="w-full md:w-[20%] bg-slate-900 border-l border-white/10 overflow-y-auto">
            {result.score !== undefined ? (
                <div className="p-6">
                    <h2 className="text-5xl font-black text-white">{result.score || 0}</h2>
                    <p className="text-xs text-green-400 uppercase tracking-widest">Total Score</p>
                    
                    <div className="mt-4 bg-black/20 rounded-lg p-3 border border-white/5 space-y-2 text-[10px] md:text-xs">
                        <div className="flex justify-between items-center text-slate-300">
                            <span className="uppercase tracking-wider">📍 Base Alignment</span>
                            <span className="font-mono font-bold text-white">{result.baseDistanceScore || 0}</span>
                        </div>
                        {(result.baseTimeMultiplier !== undefined && room.game_mode === 'time_attack') && (
                            <div className="flex justify-between items-center text-orange-300">
                                <span className="uppercase tracking-wider">⏱️ Sub Time Multiplier</span>
                                <span className="font-mono font-bold text-white">x{Number(result.baseTimeMultiplier).toFixed(2)}</span>
                            </div>
                        )}
                        {result.powerupActive && (
                            <div className="flex justify-between items-center text-pink-400">
                                <span className="uppercase tracking-wider">🔥 Overclock Bonus</span>
                                <span className="font-mono font-bold text-white">x1.5</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center text-green-300 border-t border-white/10 pt-2 mt-2">
                            <span className="uppercase tracking-wider">🎯 Final Alignment Score</span>
                            <span className="font-mono font-bold text-white">+{result.distanceScore || 0}</span>
                        </div>

                        <div className="flex justify-between items-center text-blue-300 pt-2">
                            <span className="uppercase tracking-wider">🔍 Evidence Bonus</span>
                            <span className="font-mono font-bold text-white">+{result.evidenceScore || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-indigo-300">
                            <span className="uppercase tracking-wider">⚡ Speed Flat Bonus</span>
                            <span className="font-mono font-bold text-white">+{result.timeScore || 0}</span>
                        </div>
                        {result.difficultyMulti > 1 && (
                            <div className="flex justify-between items-center text-yellow-400 border-t border-white/10 pt-2 mt-2">
                                <span className="uppercase tracking-wider">⭐ Hard Mode Ext.</span>
                                <span className="font-mono font-black text-white">x{result.difficultyMulti}</span>
                            </div>
                        )}
                    </div>

                    <hr className="border-white/10 my-6" />

                    <div className="text-xl font-black text-slate-200">
                        {result.distance !== undefined && !isNaN(result.distance)
                            ? `${Math.round(result.distance)}m`
                            : "-- m"}
                    </div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Deviation</p>

                    <div className="mt-8 space-y-4">
                        <h3 className="text-xs uppercase text-slate-400 mb-2">Evidence Analysis</h3>

                        {/* Compute categorized evidence using IoU spatial overlap */}
                        {(() => {
                            const officialList = result?.officialEvidence || currentRound?.evidence || [];
                            const aiResults = result?.aiFeedback?.results || [];

                            // Helper: compute overlap between two boxes
                            const boxesOverlap = (sBox: any, oBox: any) => {
                                const ax1 = sBox.x, ay1 = sBox.y, ax2 = sBox.x + sBox.w, ay2 = sBox.y + sBox.h;
                                const bx1 = oBox.x, by1 = oBox.y, bx2 = oBox.x + oBox.w, by2 = oBox.y + oBox.h;
                                const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
                                const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
                                const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
                                const intersection = iw * ih;
                                const areaA = sBox.w * sBox.h;
                                const areaB = oBox.w * oBox.h;
                                const union = areaA + areaB - intersection;
                                const iou = union > 0 ? intersection / union : 0;
                                const coverageOfOfficial = areaB > 0 ? intersection / areaB : 0;
                                return iou >= 0.15 || coverageOfOfficial >= 0.3;
                            };

                            // Parse official bounding boxes
                            const parsedOfficials = officialList.map((ev: any) => {
                                let box = null;
                                try { box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box; } catch {}
                                return { ...ev, box };
                            });

                            // Categorize student evidence
                            const foundEvidence: { userIndex: number; official: any; aiItem: any }[] = [];
                            const novelEvidence: { userIndex: number; aiItem: any }[] = [];
                            const matchedOfficialIds = new Set<string>();

                            evidenceList.forEach((userEv: any, index: number) => {
                                const aiItem = aiResults.find((r: any) => r.index === index);
                                let matchedOfficial = null;

                                for (const oe of parsedOfficials) {
                                    if (!oe.box) continue;
                                    if (boxesOverlap(userEv.box, oe.box)) {
                                        matchedOfficial = oe;
                                        break;
                                    }
                                }

                                if (matchedOfficial) {
                                    foundEvidence.push({ userIndex: index, official: matchedOfficial, aiItem });
                                    matchedOfficialIds.add(matchedOfficial.id);
                                } else {
                                    novelEvidence.push({ userIndex: index, aiItem });
                                }
                            });

                            // Missed = official evidence not matched by any student box
                            const missedEvidence = parsedOfficials.filter((oe: any) => oe.box && !matchedOfficialIds.has(oe.id));

                            return (
                                <>
                                    {/* ✅ FOUND EVIDENCE */}
                                    {foundEvidence.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] uppercase text-green-400 tracking-widest flex items-center gap-1">
                                                <span>✅</span> Found ({foundEvidence.length})
                                            </h4>
                                            {foundEvidence.map((item, i) => (
                                                <div key={i} className="text-xs text-slate-300 border-l-2 border-green-500/50 pl-3 py-1">
                                                    <span className="font-bold text-green-400 block mb-1">
                                                        {item.official.description || item.aiItem?.description || `Evidence #${item.userIndex + 1}`}
                                                    </span>
                                                    <p className="opacity-80 leading-snug text-green-200/80">
                                                        {item.aiItem?.explanation || item.official.ai_analysis || "Correctly identified this landmark feature."}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* 🔵 NOVEL DISCOVERIES */}
                                    {novelEvidence.length > 0 && (
                                        <div className="space-y-2 mt-3">
                                            <h4 className="text-[10px] uppercase text-blue-400 tracking-widest flex items-center gap-1">
                                                <span>🔍</span> Additional Observations ({novelEvidence.length})
                                            </h4>
                                            {novelEvidence.map((item, i) => (
                                                <div key={i} className="text-xs text-slate-300 border-l-2 border-blue-500/50 pl-3 py-1">
                                                    <span className="font-bold text-blue-400 block mb-1">
                                                        {item.aiItem?.description || `Observation #${item.userIndex + 1}`}
                                                    </span>
                                                    <p className="opacity-80 leading-snug">
                                                        {item.aiItem?.explanation || "Selected area did not match any official evidence."}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* ❌ MISSED INTEL */}
                                    {missedEvidence.length > 0 && (
                                        <div className="space-y-2 mt-3">
                                            <h4 className="text-[10px] uppercase text-red-400 tracking-widest flex items-center gap-1">
                                                <span>❌</span> Missed Intel ({missedEvidence.length})
                                            </h4>
                                            {missedEvidence.map((ev: any) => {
                                                let personalizedExplanation = null;
                                                if (result.aiFeedback?.missed_evidence_explanations && Array.isArray(result.aiFeedback.missed_evidence_explanations)) {
                                                    const AIExplanation = result.aiFeedback.missed_evidence_explanations.find((m: any) => m.admin_id === ev.id);
                                                    if (AIExplanation?.explanation) personalizedExplanation = AIExplanation.explanation;
                                                }
                                                return (
                                                    <div key={ev.id} className="text-xs text-slate-400 border-l-2 border-red-500/30 pl-3 py-1">
                                                        <span className="font-bold text-red-300 block mb-1">{ev.description}</span>
                                                        {(personalizedExplanation || ev.ai_analysis) && (
                                                            <p className="opacity-70 leading-snug">{personalizedExplanation || ev.ai_analysis}</p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Summary if AI feedback has a summary */}
                                    {result.aiFeedback?.summary_explanation && (
                                        <div className="mt-3 p-3 bg-slate-800/50 rounded border border-white/5">
                                            <p className="text-xs text-slate-400 leading-relaxed italic">{result.aiFeedback.summary_explanation}</p>
                                        </div>
                                    )}

                                    {/* No evidence at all */}
                                    {foundEvidence.length === 0 && novelEvidence.length === 0 && missedEvidence.length === 0 && (
                                        <p className="text-xs text-slate-500 italic">No evidence data available for this round.</p>
                                    )}
                                </>
                            );
                        })()}

                        {/* Matched Evidence Summary */}
                        {result.evidenceScore > 0 && (
                            <div className="mt-2 py-2 px-3 bg-green-500/20 rounded border border-green-500/30 flex justify-between">
                                <span className="text-green-400 text-xs font-bold">Intel Bonus</span>
                                <span className="text-white text-xs font-bold">+{result.evidenceScore}</span>
                            </div>
                        )}
                    </div>

                    <div className="mt-8">
                        <h3 className="text-xs uppercase text-slate-400 mb-2">Waiting for next round...</h3>
                    </div>
                </div>
            ) : (
                <div className="p-6 text-center text-slate-500 italic">
                    {result.message || "Analysis Complete. Data Encrypted. Waiting for HQ Reveal..."}
                </div>
            )}
        </div>
    );
}
