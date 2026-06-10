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
            className={`relative h-full md:h-full bg-slate-900 border-r border-white/10 ${isMapScrambled ? 'saturate-200 invert hue-rotate-180 blur-[2px] scale-y-[-1]' : ''}
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
                                    <div className="w-full py-3 bg-red-500/20 text-red-300 border border-red-500/50 backdrop-blur-md rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 animate-in fade-in transition-all">
                                        <span className="text-lg">📶</span>
                                        Signal Strong • Scan Disabled
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleVicinityScan}
                                        className="w-full py-3 bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-300 border border-yellow-500/50 backdrop-blur-md rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 animate-pulse"
                                    >
                                        <span className="text-lg">📡</span>
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
                            <button id="submit-btn" onClick={handleSubmit} disabled={!guess} className={`w-full py-4 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all border border-white/10 backdrop-blur-xl ${guess ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-black/40 text-white/20'} ${currentRound?.isGuidedRound && tutorialStep === 6 ? 'tutorial-spotlight' : ''}`}>
                                CONFIRM COORDINATES
                            </button>
                        </div>
                    </>
                ) : (
                    room.status === 'PLAYING' && (
                        <div className="absolute bottom-10 md:bottom-6 left-6 right-6 z-10">
                            {actionFetcher.state !== "idle" ? (
                                <div className="border font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5 bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
                                    <div className="text-xs uppercase tracking-widest mb-1 text-yellow-300">Target Acquired</div>
                                    <div className="text-lg font-black animate-pulse">SENDING AI TO HQ...</div>
                                    <div className="text-[10px] font-mono opacity-70 mt-1 uppercase">AI is generating your map analysis...</div>
                                </div>
                            ) : actionFetcher.data?.aiFeedback ? (
                                <div className="border font-bold p-4 rounded-xl shadow-lg backdrop-blur-3xl animate-in slide-in-from-bottom-5 bg-slate-900/95 text-slate-200 border-blue-500/50 max-h-[40vh] overflow-y-auto pointer-events-auto">
                                    <div className="text-[10px] font-black uppercase tracking-widest mb-3 text-blue-400 border-b border-white/10 pb-2 flex justify-between items-center">
                                        <span>HQ AI Preliminary Report</span>
                                        <span className="text-emerald-400">AWAITING REVIEW</span>
                                    </div>
                                    {actionFetcher.data.aiFeedback.results?.length > 0 ? (
                                        <div className="space-y-3">
                                            {actionFetcher.data.aiFeedback.results.map((r: any, idx: number) => (
                                                <div key={idx} className="bg-black/40 p-3 rounded-lg border border-white/5 relative overflow-hidden">
                                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${r.validity >= 0.7 ? "bg-green-500" : (r.validity >= 0.4 ? "bg-yellow-500" : "bg-red-500")}`} />
                                                    <div className="text-white text-xs font-bold pl-2">{r.description || "Unknown Intel"}</div>
                                                    <div className="text-slate-400 text-[10px] mt-1 pl-2 leading-relaxed font-normal">{r.explanation}</div>
                                                    <div className="mt-2 pl-2 text-[10px] font-black uppercase flex items-center gap-2">
                                                        <span className={r.validity >= 0.7 ? "text-green-400" : (r.validity >= 0.4 ? "text-yellow-400" : "text-red-400")}>
                                                            CONFIDENCE: {Math.round(r.validity * 100)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-sm p-4 text-center text-slate-400 font-normal">
                                            No recognizable intel items detected in your scan.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="border font-bold p-4 rounded-xl text-center shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-5 bg-emerald-500/20 text-emerald-400 border-emerald-500/50">
                                    <div className="text-xs uppercase tracking-widest mb-1 text-emerald-300">Target Acquired</div>
                                    <div className="text-lg font-black">LOCKED IN</div>
                                    <div className="text-[10px] font-mono opacity-70 mt-1 uppercase">Transmission Secure. Awaiting Mission Control...</div>
                                </div>
                            )}
                        </div>
                    )
                )
            }
        </div >
    );
}
