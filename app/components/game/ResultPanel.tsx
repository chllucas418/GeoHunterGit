export function ResultPanel({ result, layoutMode, room, currentRound, evidenceList }: any) {
    if (!result || layoutMode !== "result") return null;

    return (
        <div className="w-full md:w-[20%] bg-[#0e1a14] border-l border-brass/15 overflow-y-auto">
            {result.score !== undefined ? (
                <div className="p-5">
                    {/* Field Report Header */}
                    <div className="mb-5 pb-4 border-b border-brass/20">
                        <div className="text-[9px] font-mono text-stone uppercase tracking-[0.3em] mb-1">Expedition Report</div>
                        <h2 className="font-heading text-4xl font-black text-brass">{result.score || 0}</h2>
                        <p className="text-[10px] text-teal uppercase tracking-widest mt-1">Total Points</p>
                    </div>

                    {/* Score Breakdown — Field Ledger Style */}
                    <div className="space-y-1.5 text-[10px] md:text-xs">
                        <div className="flex justify-between items-center text-stone-light py-2 border-b border-brass/10">
                            <span className="uppercase tracking-wider text-stone">Base Alignment</span>
                            <span className="font-mono font-bold text-cream">{result.baseDistanceScore || 0}</span>
                        </div>
                        {(result.baseTimeMultiplier !== undefined && room.game_mode === 'time_attack') && (
                            <div className="flex justify-between items-center text-amber py-2 border-b border-brass/10">
                                <span className="uppercase tracking-wider text-stone">Sub Time Multiplier</span>
                                <span className="font-mono font-bold text-cream">x{Number(result.baseTimeMultiplier).toFixed(2)}</span>
                            </div>
                        )}
                        {result.powerupActive && (
                            <div className="flex justify-between items-center text-rust py-2 border-b border-brass/10">
                                <span className="uppercase tracking-wider text-stone">Overclock Bonus</span>
                                <span className="font-mono font-bold text-cream">x1.5</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center text-teal py-2 border-b border-brass/10">
                            <span className="uppercase tracking-wider text-stone">Final Alignment Score</span>
                            <span className="font-mono font-bold text-cream">+{result.distanceScore || 0}</span>
                        </div>

                        <div className="flex justify-between items-center text-brass py-2 border-b border-brass/10">
                            <span className="uppercase tracking-wider text-stone">Evidence Bonus</span>
                            <span className="font-mono font-bold text-cream">+{result.evidenceScore || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-teal-dark py-2 border-b border-brass/10">
                            <span className="uppercase tracking-wider text-stone">Speed Flat Bonus</span>
                            <span className="font-mono font-bold text-cream">+{result.timeScore || 0}</span>
                        </div>
                        {result.difficultyMulti > 1 && (
                            <div className="flex justify-between items-center text-amber py-2 border-b border-brass/10">
                                <span className="uppercase tracking-wider text-stone">Hard Mode Extension</span>
                                <span className="font-mono font-black text-cream">x{result.difficultyMulti}</span>
                            </div>
                        )}
                    </div>

                    {/* Deviation */}
                    <div className="mt-6 pt-4 border-t border-brass/20">
                        <div className="font-mono text-lg font-bold text-cream">
                            {result.distance !== undefined && !isNaN(result.distance)
                                ? `${Math.round(result.distance)}m`
                                : "-- m"}
                        </div>
                        <p className="text-[10px] text-stone uppercase tracking-widest mt-1">Deviation from Target</p>
                    </div>

                    {/* Evidence Analysis — Field Notes */}
                    <div className="mt-8">
                        <h3 className="text-[10px] uppercase text-stone mb-3 flex items-center gap-2">
                            <span className="text-brass">▸</span> Field Analysis
                        </h3>

                        {(() => {
                            const officialList = result?.officialEvidence || currentRound?.evidence || [];
                            const aiResults = result?.aiFeedback?.results || [];

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

                            const parsedOfficials = officialList.map((ev: any) => {
                                let box = null;
                                try { box = typeof ev.bounding_box === 'string' ? JSON.parse(ev.bounding_box) : ev.bounding_box; } catch {}
                                return { ...ev, box };
                            });

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

                            const missedEvidence = parsedOfficials.filter((oe: any) => oe.box && !matchedOfficialIds.has(oe.id));

                            return (
                                <>
                                    {/* Found Evidence */}
                                    {foundEvidence.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] uppercase text-teal tracking-widest flex items-center gap-1">
                                                <span>✓</span> Identified ({foundEvidence.length})
                                            </h4>
                                            {foundEvidence.map((item, i) => (
                                                <div key={i} className="text-xs text-stone-light border-l-2 border-teal/50 pl-3 py-2 bg-[#1a3a2f]/30 rounded-r">
                                                    <span className="font-bold text-teal-light block mb-1">
                                                        {item.official.description || item.aiItem?.description || `Evidence #${item.userIndex + 1}`}
                                                    </span>
                                                    <p className="opacity-80 leading-snug text-stone">
                                                        {item.aiItem?.explanation || (item.official.ai_analysis && item.official.ai_analysis !== "Real-time analysis active." ? item.official.ai_analysis : "Correctly identified this landmark feature.")}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Novel Discoveries */}
                                    {novelEvidence.length > 0 && (
                                        <div className="space-y-2 mt-3">
                                            <h4 className="text-[10px] uppercase text-brass tracking-widest flex items-center gap-1">
                                                <span>★</span> Additional Observations ({novelEvidence.length})
                                            </h4>
                                            {novelEvidence.map((item, i) => (
                                                <div key={i} className="text-xs text-stone-light border-l-2 border-brass/50 pl-3 py-2 bg-[#1a3a2f]/20 rounded-r">
                                                    <span className="font-bold text-brass block mb-1">
                                                        {item.aiItem?.description || `Observation #${item.userIndex + 1}`}
                                                    </span>
                                                    <p className="opacity-80 leading-snug">
                                                        {item.aiItem?.explanation || "Selected area did not match any official evidence."}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Missed Intel */}
                                    {missedEvidence.length > 0 && (
                                        <div className="space-y-2 mt-3">
                                            <h4 className="text-[10px] uppercase text-rust tracking-widest flex items-center gap-1">
                                                <span>—</span> Missed Intel ({missedEvidence.length})
                                            </h4>
                                            {missedEvidence.map((ev: any) => {
                                                let personalizedExplanation = null;
                                                if (result.aiFeedback?.missed_evidence_explanations && Array.isArray(result.aiFeedback.missed_evidence_explanations)) {
                                                    const AIExplanation = result.aiFeedback.missed_evidence_explanations.find((m: any) => m.admin_id === ev.id);
                                                    if (AIExplanation?.explanation) personalizedExplanation = AIExplanation.explanation;
                                                }
                                                return (
                                                    <div key={ev.id} className="text-xs text-stone/70 border-l-2 border-rust/30 pl-3 py-2 bg-[#1a1a18]/40 rounded-r">
                                                        <span className="font-bold text-rust/80 block mb-1">{ev.description}</span>
                                                        {(() => {
                                                            const displayExpl = (personalizedExplanation && personalizedExplanation !== "Real-time analysis active.")
                                                                ? personalizedExplanation
                                                                : (ev.ai_analysis && ev.ai_analysis !== "Real-time analysis active." ? ev.ai_analysis : null);
                                                            return displayExpl ? (
                                                                <p className="opacity-70 leading-snug">{displayExpl}</p>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Summary */}
                                    {result.aiFeedback?.summary_explanation && (
                                        <div className="mt-3 p-3 bg-[#1a3a2f]/30 rounded border border-brass/10">
                                            <p className="text-xs text-stone leading-relaxed italic">{result.aiFeedback.summary_explanation}</p>
                                        </div>
                                    )}

                                    {/* No evidence */}
                                    {foundEvidence.length === 0 && novelEvidence.length === 0 && missedEvidence.length === 0 && (
                                        <p className="text-xs text-stone/50 italic">No evidence data available for this round.</p>
                                    )}
                                </>
                            );
                        })()}

                        {/* Intel Bonus Summary */}
                        {result.evidenceScore > 0 && (
                            <div className="mt-3 py-2 px-3 bg-teal/10 rounded border border-teal/30 flex justify-between">
                                <span className="text-teal text-xs font-bold">Intel Bonus</span>
                                <span className="text-cream text-xs font-bold">+{result.evidenceScore}</span>
                            </div>
                        )}
                    </div>

                    <div className="mt-8 pt-4 border-t border-brass/10">
                        <p className="text-[10px] text-stone/50 uppercase tracking-widest">Awaiting next sector assignment...</p>
                    </div>
                </div>
            ) : (
                <div className="p-5 text-center">
                    <div className="text-stone/40 text-sm font-mono">Analysis Complete</div>
                    <div className="text-[9px] text-stone/30 uppercase tracking-widest mt-2">Data Encrypted — Awaiting HQ Reveal</div>
                </div>
            )}
        </div>
    );
}