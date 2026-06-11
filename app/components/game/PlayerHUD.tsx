import { FadingHint } from "./FadingHint";

// Tutorial steps — concise: icon + short phrase (under 15 words each)
const TUTORIAL_STEPS = [
    { icon: "🎓", text: "Welcome Agent! Your mission: Pinpoint this location on the map." },
    { icon: "📷", text: "Tap 'Enable Scanner' above, then draw a box around any clue in the image." },
    { icon: "💡", text: "Hints will appear here over time. Watch for them!" },
    { icon: "⚡", text: "Use energy powers to help yourself or slow others down!" },
    { icon: "🗺️", text: "Tap the satellite map on the right to drop your coordinate pin." },
    { icon: "✅", text: "Press CONFIRM COORDINATES to lock in your guess." },
    { icon: "🚀", text: "Mission starts now — good luck, Agent!" },
];

const TUTORIAL_TARGETS = [null, "scanner-btn", "hint-area", "action-bar", "map-area", "submit-btn", null];

export function PlayerHUD({
    room, currentRound, secondsElapsed, hintList, introStage, location,
    hasAcknowledgedRules, setHasAcknowledgedRules, tutorialStep, setTutorialStep,
    evidenceList, guess, submitted, visibleHints, isIntelCorrupted,
    isEvidenceMode, setIsEvidenceMode
}: any) {

    const tutorialTargetId = TUTORIAL_TARGETS[tutorialStep - 1];

    return (
        <>
            {/* Header / Timer & Hints */}
            {room.status === 'PLAYING' && (
                <div className="absolute top-0 inset-x-0 z-[60] p-4 flex justify-between items-start pointer-events-none safe-top">
                    {/* Atlas Field Dossier — Timer Panel */}
                    <div className="bg-[#0e1a14]/90 backdrop-blur-xl px-5 py-2.5 rounded border border-brass/25 flex flex-col items-center mx-auto pointer-events-auto shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(201,168,76,0.1)]">
                        <div suppressHydrationWarning className={`font-mono text-4xl font-bold tracking-tighter drop-shadow-md ${
                            (currentRound && ((currentRound.timeLimit || 120) - secondsElapsed) < 30)
                                ? 'text-rust'
                                : 'text-brass'
                        }`}>
                            {currentRound ? (
                                <>
                                    {Math.floor(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) / 60)}:{(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) % 60).toString().padStart(2, '0')}
                                </>
                            ) : "--:--"}
                        </div>
                        {/* Next Hint Indicator */}
                        {currentRound && (Math.floor(secondsElapsed / (room.hint_interval || 30)) + 1) <= hintList.length && (
                            <div className="flex items-center gap-2 mt-1">
                                <div className="w-1.5 h-1.5 bg-brass rounded-full animate-pulse" />
                                <span className="text-[10px] text-stone-light font-mono uppercase">
                                    Next signal in {Math.max(0, (room.hint_interval || 30) - (secondsElapsed % (room.hint_interval || 30)))}s
                                </span>
                            </div>
                        )}
                    </div>

                    {/* REWARD ROUND BANNER */}
                    {currentRound?.isRewardRound && (
                        <div className="absolute top-20 inset-x-0 flex justify-center pointer-events-none">
                            <div className="bg-gradient-to-r from-amber to-amber-light px-6 py-1.5 rounded border-2 border-brass shadow-[0_0_20px_rgba(212,130,42,0.4)] animate-bounce pointer-events-auto">
                                <span className="text-[10px] font-black text-charcoal uppercase tracking-[0.3em] flex items-center gap-2">
                                    <span className="text-sm">🔥</span> REWARD ROUND: 2X POINTS <span className="text-sm">🔥</span>
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Intro Splash */}
            {introStage < 3 && location && (
                <div className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-[#0e1a14]/80 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                    <div className="text-center">
                        <div className="mb-3 text-[10px] font-mono text-teal tracking-[0.3em] uppercase">Incoming Transmission</div>
                        <h1 className="font-heading text-5xl font-black text-cream tracking-tight mb-3">Sector {location.id?.slice(-4).toUpperCase()}</h1>
                        <div className="text-3xl text-brass">{"★".repeat(Math.ceil((location.difficulty_rating || 1) / 2))}</div>
                        <div className="mt-3 text-[10px] font-mono font-bold text-teal uppercase tracking-[0.2em] border border-teal/30 px-3 py-1 rounded bg-teal/10 inline-block">
                            {currentRound.evidenceCount || 0} Intel Items Detected
                        </div>
                        {currentRound?.isRewardRound && (
                            <div className="mt-5 animate-bounce">
                                <div className="bg-gradient-to-r from-amber to-amber-light text-charcoal px-5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest">
                                    💰 Reward Round Active — 2X Points
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* STRICT GAME MODE ACKNOWLEDGMENT */}
            {room.status === 'PLAYING' && currentRound?.index === 0 && !hasAcknowledgedRules && (
                <div className="absolute inset-0 z-[100] bg-[#0e1a14]/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-in slide-in-from-bottom-10 pointer-events-auto">
                    <div className="max-w-2xl w-full bg-[#0e1a14] border border-brass/30 rounded-2xl p-8 md:p-12 shadow-[0_8px_40px_rgba(0,0,0,0.8)]">
                        {/* File header */}
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 border-2 border-brass/50 rounded flex items-center justify-center">
                                <span className="text-brass text-sm">📁</span>
                            </div>
                            <div>
                                <div className="text-[9px] font-mono text-stone uppercase tracking-[0.3em]">Field Dossier</div>
                                <h2 className="font-heading text-3xl font-black text-cream uppercase tracking-tight">Mission Briefing</h2>
                            </div>
                        </div>
                        <div className="h-px bg-gradient-to-r from-brass/50 via-brass/20 to-transparent mb-8" />

                        {/* Mode-specific brief */}
                        {room.game_mode === 'time_attack' && (
                            <div className="space-y-4 text-left">
                                <h3 className="font-heading text-xl font-bold text-amber uppercase tracking-widest flex items-center gap-2">
                                    <span>⏱</span> Time Attack Protocol
                                </h3>
                                <ul className="space-y-2 text-stone-light">
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Confirm within <span className="text-teal-light font-bold">30s</span> for a <span className="text-teal-light font-bold">2.0x multiplier</span></li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Your multiplier decays the longer you wait</li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Pin the location as precisely as possible</li>
                                </ul>
                            </div>
                        )}
                        {room.game_mode === 'teams' && (
                            <div className="space-y-4 text-left">
                                <h3 className="font-heading text-xl font-bold text-teal uppercase tracking-widest flex items-center gap-2">
                                    <span>⚔</span> Squad Battle Protocol
                                </h3>
                                <ul className="space-y-2 text-stone-light">
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Your score contributes to your Squad's total</li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Use sabotage powers against rival factions</li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Coordinate with your team verbally</li>
                                </ul>
                            </div>
                        )}
                        {(room.game_mode === 'standard' || !room.game_mode) && (
                            <div className="space-y-4 text-left">
                                <h3 className="font-heading text-xl font-bold text-cream uppercase tracking-widest flex items-center gap-2">
                                    <span>🎯</span> Standard Protocol
                                </h3>
                                <ul className="space-y-2 text-stone-light">
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Find the location using clues and field intel</li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Place your pin as accurately as possible</li>
                                    <li className="flex items-start gap-2"><span className="text-brass font-black mt-0.5">›</span> Only one agent reaches the podium</li>
                                </ul>
                            </div>
                        )}

                        <div className="mt-10 pt-6 border-t border-brass/20">
                            <button
                                onClick={() => setHasAcknowledgedRules(true)}
                                className="w-full py-5 bg-gradient-to-r from-brass to-brass-dark hover:from-brass-light hover:to-brass text-charcoal font-black text-base uppercase tracking-[0.2em] rounded transition-all shadow-[0_4px_16px_rgba(201,168,76,0.3)] active:scale-[0.98]"
                            >
                                I Acknowledge — Proceed to Mission
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* TUTORIAL OVERLAY */}
            {room.has_guided_playthrough === 1 && currentRound?.index === 0 && tutorialStep > 0 && tutorialStep < 8 && (
                <>
                    <div className="absolute inset-0 z-[95] bg-[#0e1a14]/70 backdrop-blur-sm pointer-events-none" />

                    <div className="absolute inset-x-0 bottom-0 z-[97] flex flex-col items-center justify-end pb-[max(env(safe-area-inset-bottom),24px)] px-4 safe-bottom pointer-events-none">
                        <div className="bg-[#0e1a14]/95 backdrop-blur-xl border border-brass/40 p-5 rounded-t-2xl max-w-md shadow-2xl pointer-events-auto animate-in slide-in-from-bottom-10 w-full">
                            <div className="flex items-start gap-3 mb-3">
                                <div className="text-3xl flex-shrink-0">{TUTORIAL_STEPS[tutorialStep - 1].icon}</div>
                                <p className="text-sm text-stone-light leading-relaxed pt-1">
                                    {TUTORIAL_STEPS[tutorialStep - 1].text}
                                </p>
                            </div>

                            <div className="flex justify-between items-center">
                                <div className="flex gap-1.5">
                                    {[1, 2, 3, 4, 5, 6, 7].map(s => (
                                        <div
                                            key={s}
                                            className={`h-1.5 rounded-full transition-all ${s === tutorialStep ? 'bg-brass w-4' : 'bg-brass/30 w-1.5'}`}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={() => setTutorialStep((prev: number) => prev + 1)}
                                    disabled={
                                        (tutorialStep === 2 && evidenceList.length === 0) ||
                                        (tutorialStep === 5 && guess === null)
                                    }
                                    className={`px-6 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all
                                        ${((tutorialStep === 2 && evidenceList.length === 0) || (tutorialStep === 5 && guess === null))
                                            ? 'bg-[#1a3a2f] text-stone/50 cursor-not-allowed border border-stone/20'
                                            : 'bg-brass text-charcoal hover:bg-brass-light active:scale-95'
                                        }`}
                                >
                                    {tutorialStep === 7 ? "Begin Mission 🚀" : "Next ›"}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Hints Overlay */}
            {!submitted && visibleHints.length > 0 && (
                <div id="hint-area" className="absolute bottom-28 left-4 md:bottom-32 md:left-6 z-[30] w-[calc(100%-2rem)] max-w-sm space-y-2 pointer-events-none">
                    {visibleHints.map((hint: string, i: number) => (
                        <FadingHint
                            key={i}
                            hint={hint}
                            index={i}
                            totalHints={hintList?.length}
                            isIntelCorrupted={isIntelCorrupted}
                        />
                    ))}
                </div>
            )}

            {/* Intel Signal Banner */}
            {currentRound?.evidenceCount !== undefined && introStage >= 3 && (
                <div className="absolute top-20 md:top-24 left-1/2 -translate-x-1/2 z-40 w-max animate-in slide-in-from-top-10 duration-700">
                    <div className="bg-[#0e1a14]/90 backdrop-blur-xl border border-teal/40 px-5 py-2 rounded shadow-[0_4px_20px_rgba(0,0,0,0.4),0_0_12px_rgba(74,155,140,0.15)] flex flex-col items-center">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <span className="text-lg">📡</span>
                                <div className="absolute -top-1 -right-1 w-2 h-2 bg-teal rounded-full animate-ping" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-teal uppercase tracking-[0.25em] leading-none mb-0.5">Scan Active</span>
                                <span className="text-sm font-bold text-cream uppercase tracking-tight tabular-nums">
                                    {currentRound.evidenceCount} <span className="text-teal/80">Intel Signals</span>
                                </span>
                            </div>
                        </div>
                        <div className="mt-1.5 w-full h-px bg-teal/20 rounded-full overflow-hidden">
                            <div className="h-full bg-teal animate-[shimmer_2s_infinite] w-1/3" />
                        </div>
                    </div>
                </div>
            )}

            {/* Mode Toggle */}
            {!submitted && (
                <div id="scanner-btn" className="absolute top-4 right-4 md:top-6 md:right-6 z-[90] flex flex-col items-end gap-2 pointer-events-auto safe-top">
                    <button
                        onClick={() => setIsEvidenceMode(!isEvidenceMode)}
                        className={`px-3 py-1.5 md:px-4 md:py-2 rounded text-[10px] md:text-xs font-bold uppercase tracking-[0.15em] border transition-all shadow-xl backdrop-blur-md touch-target
                            ${isEvidenceMode
                                ? 'bg-teal/20 text-teal border-teal'
                                : 'bg-[#0e1a14]/80 text-cream border-brass/30 hover:border-brass/60 hover:bg-[#1a3a2f]/60'
                            } ${currentRound?.isGuidedRound && tutorialStep === 2 && !isEvidenceMode ? 'tutorial-spotlight' : ''}`}
                    >
                        {isEvidenceMode ? "Scanner Active" : "Enable Scanner"}
                    </button>
                    <div className="text-[9px] font-bold text-teal uppercase tracking-widest bg-teal/10 px-2 py-0.5 rounded border border-teal/30">
                        Extra marks for novel discoveries! 🗃️
                    </div>
                </div>
            )}
        </>
    );
}