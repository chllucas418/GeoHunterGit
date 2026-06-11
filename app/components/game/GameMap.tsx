import { HighPrecisionTimeAttackHUD } from "~/components/game/TimeAttackHUD";

export function GameMap({
    layoutMode, isMapScrambled, splitRatio, mapRef, mapCanvasRef,
    submitted, isTimeUp, currentRound, tutorialStep,
    isVicinityScanAvailable, hasZoomed, isTargetInRange, handleVicinityScan,
    room, serverClockOffsetRef, submittedAtSeconds, result, hasScoreMultiplier,
    guess, handleSubmit, actionFetcher
}: any) {
    return (
        <div
            className={`relative h-full md:h-full bg-[#0e1a14] border-r border-brass/10 ${isMapScrambled ? 'saturate-200 invert hue-rotate-180 blur-[2px] scale-y-[-1]' : ''}
                ${layoutMode === "result" ? "hidden md:block md:w-[40%]" : "w-full"}`}
            style={layoutMode !== "result" ? { flexBasis: `${100 - splitRatio}%` } : {}}
        >
            <div ref={mapRef} className="w-full h-full relative z-0" />

            {/* Tutorial Column 2 Blur Overlay */}
            {!submitted && currentRound?.isGuidedRound && (tutorialStep >= 1 && tutorialStep <= 5) && (
                <div className="absolute inset-0 z-[65] bg-black/60 backdrop-blur-md transition-all duration-500" />
            )}

            {/* SYNCHRONIZED DRAWING LAYER */}
            <canvas
                ref={mapCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-10 mix-blend-screen"
            />

            {
                !submitted && !isTimeUp ? (
                    <>
                        {/* Vicinity Scan Button */}
                        {!submitted && isVicinityScanAvailable && !hasZoomed && (
                            <div className="absolute bottom-[280px] md:bottom-[220px] left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-20">
                                {isTargetInRange ? (
                                    <div className="w-full py-3 bg-rust/20 text-rust border border-rust/50 backdrop-blur-md rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 animate-in fade-in transition-all font-mono">
                                        <span className="text-base">📶</span>
                                        Signal Locked • Scan Standby
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleVicinityScan}
                                        className="w-full py-3 bg-amber/15 hover:bg-amber/30 text-amber border border-amber/50 backdrop-blur-md rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 animate-pulse font-mono"
                                    >
                                        <span className="text-base">📡</span>
                                        Initiate Vicinity Scan
                                    </button>
                                )}
                            </div>
                        )}

                        {/* [UI] TIME ATTACK BURN BAR */}
                        {room.game_mode === 'time_attack' && (
                            <div className="absolute bottom-[210px] md:bottom-[170px] left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-[9990] pointer-events-none">
                                <HighPrecisionTimeAttackHUD 
                                    currentRound={currentRound} 
                                    room={room}
                                    serverClockOffsetRef={serverClockOffsetRef} 
                                    submittedAtSeconds={submittedAtSeconds} 
                                    result={result} 
                                    hasScoreMultiplier={hasScoreMultiplier} 
                                />
                            </div>
                        )}

                        <div id="map-area" className="absolute bottom-[130px] md:bottom-[100px] left-1/2 -translate-x-1/2 w-full max-w-xs px-4">
                            <button id="submit-btn" onClick={handleSubmit} disabled={!guess} className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-sm shadow-xl transition-all border backdrop-blur-xl font-mono ${guess ? 'bg-gradient-to-r from-brass/90 to-amber/80 hover:from-brass hover:to-amber text-charcoal border-brass/50 hover:scale-[1.02] active:scale-[0.98]' : 'bg-[#1a1a18]/80 text-stone/30 border-stone/10 cursor-not-allowed'} ${currentRound?.isGuidedRound && tutorialStep === 6 ? 'tutorial-spotlight' : ''}`}>
                                CONFIRM COORDINATES
                            </button>
                        </div>
                    </>
                ) : (
                    room.status === 'PLAYING' && (
                        <div className="absolute bottom-10 md:bottom-6 left-6 right-6 z-10">
                            {actionFetcher.state !== "idle" ? (
                                <div className="border font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5 bg-amber/20 text-amber border-amber/50 font-mono">
                                    <div className="text-[10px] uppercase tracking-widest mb-1 text-amber/80">Target Acquired</div>
                                    <div className="text-lg font-black animate-pulse">SENDING TO HQ...</div>
                                    <div className="text-[10px] opacity-70 mt-1 uppercase text-stone-light">AI is generating your map analysis...</div>
                                </div>
                            ) : actionFetcher.data?.aiFeedback ? (
                                <div className="border font-bold p-4 rounded-xl shadow-lg backdrop-blur-3xl animate-in slide-in-from-bottom-5 bg-[#0e1a14]/95 text-cream border-brass/50 max-h-[40vh] overflow-y-auto pointer-events-auto">
                                    <div className="text-[10px] font-black uppercase tracking-widest mb-3 text-brass border-b border-brass/20 pb-2 flex justify-between items-center">
                                        <span>HQ Analysis Report</span>
                                        <span className="text-teal">AWAITING REVIEW</span>
                                    </div>
                                    {actionFetcher.data.aiFeedback.results?.length > 0 ? (
                                        <div className="space-y-3">
                                            {actionFetcher.data.aiFeedback.results.map((r: any, idx: number) => (
                                                <div key={idx} className="bg-[#1a1a18]/60 p-3 rounded-lg border border-brass/10 relative overflow-hidden">
                                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${r.validity >= 0.7 ? "bg-teal" : (r.validity >= 0.4 ? "bg-amber" : "bg-rust")}`} />
                                                    <div className="text-cream text-xs font-bold pl-2">{r.description || "Unknown Intel"}</div>
                                                    <div className="text-stone-light text-[10px] mt-1 pl-2 leading-relaxed font-normal">{r.explanation}</div>
                                                    <div className="mt-2 pl-2 text-[10px] font-black uppercase flex items-center gap-2">
                                                        <span className={r.validity >= 0.7 ? "text-teal" : (r.validity >= 0.4 ? "text-amber" : "text-rust")}>
                                                            CONFIDENCE: {Math.round(r.validity * 100)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-sm p-4 text-center text-stone-light font-normal">
                                            No recognizable intel items detected in your scan.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="border font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5 bg-teal/20 text-teal border-teal/50 font-mono">
                                    <div className="text-[10px] uppercase tracking-widest mb-1 text-teal/80">Target Acquired</div>
                                    <div className="text-lg font-black">LOCKED IN</div>
                                    <div className="text-[10px] opacity-70 mt-1 uppercase text-stone-light">Transmission Secure. Awaiting Mission Control...</div>
                                </div>
                            )}
                        </div>
                    )
                )
            }
        </div >
    );
}
