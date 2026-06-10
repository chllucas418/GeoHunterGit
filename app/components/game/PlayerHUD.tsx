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

// Spotlight target IDs for each tutorial step
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
                    <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 flex flex-col items-center mx-auto pointer-events-auto">
                        <div suppressHydrationWarning className={`text-4xl font-black font-mono tracking-tighter drop-shadow-lg ${(currentRound && ((currentRound.timeLimit || 120) - secondsElapsed) < 30) ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                            {currentRound ? (
                                <>
                                    {Math.floor(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) / 60)}:{(Math.max(0, (currentRound.timeLimit || 120) - secondsElapsed) % 60).toString().padStart(2, '0')}
                                </>
                            ) : "--:--"}
                        </div>
                        {/* Hint Timer - Only show if hints remaining */}
                        {currentRound && (Math.floor(secondsElapsed / (room.hint_interval || 30)) + 1) <= hintList.length && (
                            <div className="flex items-center gap-2 mt-1">
                                <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                                <span className="text-[10px] text-yellow-100 font-mono uppercase">
                                    Hint in {Math.max(0, (room.hint_interval || 30) - (secondsElapsed % (room.hint_interval || 30)))}s
                                </span>
                            </div>
                        )}
                    </div>

                    {/* [UI] REWARD ROUND BANNER */}
                    {currentRound?.isRewardRound && (
                        <div className="absolute top-20 inset-x-0 flex justify-center pointer-events-none">
                            <div className="bg-gradient-to-r from-yellow-600 to-amber-600 px-6 py-1.5 rounded-full border-2 border-yellow-400 shadow-[0_0_20px_rgba(251,191,36,0.5)] animate-bounce pointer-events-auto">
                                <span className="text-[10px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-2">
                                    <span className="text-sm">🔥</span> REWARD ROUND: 2X POINTS <span className="text-sm">🔥</span>
                                </span>
                            </div>
                        </div>
                    )}

                </div>
            )}

            {/* Intro Splash */}
            {introStage < 3 && location && (
                <div className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none transition-all duration-1000 ease-in-out bg-black/60 backdrop-blur-xl ${introStage === 2 ? 'opacity-0' : 'opacity-100'}`}>
                    <div className="text-center">
                        <div className="mb-2 text-[10px] font-mono text-blue-300 tracking-widest uppercase">Incoming Transmission</div>
                        <h1 className="text-6xl font-black text-white tracking-tighter mb-2">SECTOR {location.id?.slice(-4).toUpperCase()}</h1>
                        <div className="text-4xl font-black text-yellow-400">{"★".repeat(Math.ceil((location.difficulty_rating || 1) / 2))}</div>
                        <div className="mt-2 text-[10px] font-mono font-bold text-blue-300 uppercase tracking-widest border border-blue-500/30 px-2 py-1 rounded bg-blue-500/10 inline-block">
                            {currentRound.evidenceCount || 0} Intel Items
                        </div>
                        {currentRound?.isRewardRound && (
                            <div className="mt-4 animate-bounce">
                                <div className="bg-yellow-500 text-black px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest">
                                    💰 Reward Round: 2X Points!
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* STRICT GAME MODE ACKNOWLEDGMENT (Only on Round 1) */}
            {room.status === 'PLAYING' && currentRound?.index === 0 && !hasAcknowledgedRules && (
                <div className="absolute inset-0 z-[100] bg-slate-900/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-in slide-in-from-bottom-10 pointer-events-auto">
                    <div className="max-w-2xl w-full bg-black border border-white/20 rounded-3xl p-8 md:p-12 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                        <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">MISSION BRIEFING</h2>
                        <div className="w-16 h-2 bg-blue-500 mx-auto mb-8 rounded-full" />

                        {/* Mode-specific brief — 2-3 concise bullet points */}
                        {room.game_mode === 'time_attack' && (
                            <div className="space-y-4 text-left">
                                <h3 className="text-2xl font-black text-blue-400 uppercase tracking-widest flex items-center gap-2"><span>⏰</span> Time Attack</h3>
                                <ul className="space-y-2 text-slate-300">
                                    <li className="flex items-start gap-2"><span className="text-blue-400 font-black">•</span> Confirm within <span className="text-green-400 font-bold">30s</span> for a <span className="text-green-400 font-bold">2.0x multiplier</span></li>
                                    <li className="flex items-start gap-2"><span className="text-blue-400 font-black">•</span> Your multiplier drops the longer you wait</li>
                                    <li className="flex items-start gap-2"><span className="text-blue-400 font-black">•</span> Pin the location as precisely as possible</li>
                                </ul>
                            </div>
                        )}
                        {room.game_mode === 'teams' && (
                            <div className="space-y-4 text-left">
                                <h3 className="text-2xl font-black text-green-400 uppercase tracking-widest flex items-center gap-2"><span>🛡️</span> Squad Battle</h3>
                                <ul className="space-y-2 text-slate-300">
                                    <li className="flex items-start gap-2"><span className="text-green-400 font-black">•</span> Your score contributes to your Squad's total</li>
                                    <li className="flex items-start gap-2"><span className="text-green-400 font-black">•</span> Use sabotage powers against rival factions</li>
                                    <li className="flex items-start gap-2"><span className="text-green-400 font-black">•</span> Communicate with your team verbally</li>
                                </ul>
                            </div>
                        )}
                        {(room.game_mode === 'standard' || !room.game_mode) && (
                            <div className="space-y-4 text-left">
                                <h3 className="text-2xl font-black text-white uppercase tracking-widest flex items-center gap-2"><span>🎯</span> Classic Solo</h3>
                                <ul className="space-y-2 text-slate-300">
                                    <li className="flex items-start gap-2"><span className="text-white font-black">•</span> Find the location using clues and hints</li>
                                    <li className="flex items-start gap-2"><span className="text-white font-black">•</span> Place your pin as accurately as possible</li>
                                    <li className="flex items-start gap-2"><span className="text-white font-black">•</span> Only one agent reaches the podium</li>
                                </ul>
                            </div>
                        )}

                        <button
                            onClick={() => setHasAcknowledgedRules(true)}
                            className="mt-12 w-full py-6 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xl uppercase tracking-widest shadow-[0_0_30px_rgba(37,99,235,0.4)] transition-transform hover:scale-105 active:scale-95"
                        >
                            I ACKNOWLEDGE
                        </button>
                    </div>
                </div>
            )}

            {/* --- TUTORIAL OVERLAY (CONCISE, SPOTLIGHT) --- */}
            {room.has_guided_playthrough === 1 && currentRound?.index === 0 && tutorialStep > 0 && tutorialStep < 8 && (
                <>
                    {/* Blur everything except spotlighted element */}
                    <div className="absolute inset-0 z-[95] bg-black/60 backdrop-blur-md pointer-events-none" />

                    {/* Tutorial Card — centered at bottom */}
                    <div className="absolute inset-x-0 bottom-0 z-[97] flex flex-col items-center justify-end pb-[max(env(safe-area-inset-bottom),24px)] px-4 safe-bottom pointer-events-none">
                        <div className="bg-blue-600/95 backdrop-blur-xl border-2 border-blue-400 p-5 rounded-2xl max-w-md shadow-2xl pointer-events-auto animate-in slide-in-from-bottom-10 w-full">
                            {/* Step indicator + content */}
                            <div className="flex items-start gap-3 mb-3">
                                <div className="text-3xl flex-shrink-0">{TUTORIAL_STEPS[tutorialStep - 1].icon}</div>
                                <p className="text-sm text-blue-100 leading-relaxed font-medium pt-1">
                                    {TUTORIAL_STEPS[tutorialStep - 1].text}
                                </p>
                            </div>

                            {/* Progress dots + Next button */}
                            <div className="flex justify-between items-center">
                                <div className="flex gap-1.5">
                                    {[1, 2, 3, 4, 5, 6, 7].map(s => (
                                        <div
                                            key={s}
                                            className={`w-2 h-2 rounded-full transition-all ${s === tutorialStep ? 'bg-white w-4' : 'bg-white/30'}`}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={() => setTutorialStep((prev: number) => prev + 1)}
                                    disabled={
                                        (tutorialStep === 2 && evidenceList.length === 0) ||
                                        (tutorialStep === 5 && guess === null)
                                    }
                                    className={`px-6 py-2 text-xs font-black uppercase tracking-widest rounded-full transition-all
                                        ${((tutorialStep === 2 && evidenceList.length === 0) || (tutorialStep === 5 && guess === null))
                                            ? 'bg-blue-800 text-blue-400 cursor-not-allowed'
                                            : 'bg-white text-blue-900 hover:bg-blue-50 active:scale-95'
                                        }`}
                                >
                                    {tutorialStep === 7 ? "Start 🚀" : "Next →"}
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

            {/* [UI] Persistent Intel Signal Banner */}
            {currentRound?.evidenceCount !== undefined && introStage >= 3 && (
                <div className="absolute top-20 md:top-24 left-1/2 -translate-x-1/2 z-40 w-max animate-in slide-in-from-top-10 duration-700">
                    <div className="bg-black/60 backdrop-blur-xl border border-blue-500/40 px-6 py-2 rounded-2xl shadow-[0_0_15px_rgba(59,130,246,0.3)] flex flex-col items-center">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <span className="text-xl">📡</span>
                                <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] leading-none mb-1">Scan Results</span>
                                <span className="text-sm font-black text-white uppercase tracking-tighter tabular-nums">
                                    {currentRound.evidenceCount} <span className="text-blue-300/80">Intel Signals Detected</span>
                                </span>
                            </div>
                        </div>
                        {/* Progress bar / pulse effect */}
                        <div className="mt-1.5 w-full h-0.5 bg-blue-900/40 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 animate-[shimmer_2s_infinite] w-1/3" />
                        </div>
                    </div>
                </div>
            )}

            {/* Mode Toggle */}
            {!submitted && (
                <div id="scanner-btn" className="absolute top-4 right-4 md:top-6 md:right-6 z-[90] flex flex-col items-end gap-2 pointer-events-auto safe-top">
                    <button
                        onClick={() => setIsEvidenceMode(!isEvidenceMode)}
                        className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest border transition-all shadow-xl backdrop-blur-md touch-target
                            ${isEvidenceMode ? 'bg-green-500/20 text-green-400 border-green-500' : 'bg-white/10 text-white'} ${currentRound?.isGuidedRound && tutorialStep === 2 && !isEvidenceMode ? 'tutorial-spotlight' : ''}`}
                    >
                        {isEvidenceMode ? "Scanner Active" : "Enable Scanner"}
                    </button>
                    <div className="text-[9px] font-bold text-blue-300 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30">
                        Extra marks for novel discoveries! 🗃️
                    </div>
                </div>
            )}
        </>
    );
}