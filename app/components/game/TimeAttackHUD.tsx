import { useEffect, useState } from "react";

export function HighPrecisionTimeAttackHUD({ currentRound, room, serverClockOffsetRef, submittedAtSeconds, result, hasScoreMultiplier }: any) {
    const timeLimit = currentRound?.timeLimit || 120;
    const taMax = room?.ta_max_multiplier ?? 2.0;
    const taMin = room?.ta_min_multiplier ?? 0.5;
    const graceSec = room?.ta_grace_period ?? 30;

    const START_GRACE = Math.min(graceSec, Math.floor(timeLimit * 0.25));
    const END_GRACE = Math.min(graceSec, Math.floor(timeLimit * 0.25));
    const DECAY_WINDOW = Math.max(1, timeLimit - START_GRACE - END_GRACE);

    const [displayMultiplier, setDisplayMultiplier] = useState(taMax);
    const [progress, setProgress] = useState(100);
    const [graceRemaining, setGraceRemaining] = useState(START_GRACE);

    useEffect(() => {
        let animationFrameId: number;

        const updateMultiplier = () => {
            const currentSeconds = Math.max(0, (Date.now() - serverClockOffsetRef.current - currentRound.startTime) / 1000);
            const finalSeconds = submittedAtSeconds !== null ? submittedAtSeconds : currentSeconds;
            
            let active = taMax;
            if (result?.baseTimeMultiplier !== undefined) {
                active = result.baseTimeMultiplier;
            } else if (finalSeconds > START_GRACE) {
                if (finalSeconds >= timeLimit - END_GRACE) active = taMin;
                else active = taMax - ((taMax - taMin) * ((finalSeconds - START_GRACE) / DECAY_WINDOW));
            }
            
            setDisplayMultiplier(active);
            setProgress(Math.max(0, ((active - taMin) / (taMax - taMin)) * 100));
            setGraceRemaining(Math.max(0, START_GRACE - finalSeconds));

            if (submittedAtSeconds === null && result === null) {
                animationFrameId = requestAnimationFrame(updateMultiplier);
            }
        };

        animationFrameId = requestAnimationFrame(updateMultiplier);
        return () => cancelAnimationFrame(animationFrameId);
    }, [submittedAtSeconds, result, serverClockOffsetRef, currentRound.startTime, timeLimit, taMax, taMin, START_GRACE, END_GRACE, DECAY_WINDOW]);

    const multiplierColor = displayMultiplier > 1.5 ? '#3b82f6' : displayMultiplier > 1.0 ? '#eab308' : '#ef4444';

    return (
        <div className="flex flex-col items-center pointer-events-none w-full">
            {graceRemaining > 0 && (
                <div className="mb-2 bg-blue-500/20 border border-blue-400/50 text-blue-200 px-3 py-0.5 rounded-full text-[10px] uppercase font-black tracking-widest backdrop-blur-md animate-pulse">
                    Multiplier Locked For: {graceRemaining.toFixed(1)}s
                </div>
            )}
            
            {/* Liquid Glass Dynamic Bar */}
            <div className={`w-full bg-slate-900/60 backdrop-blur-xl rounded-full border border-slate-500/30 h-8 relative overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.8)] ${hasScoreMultiplier ? 'ring-2 ring-orange-500/50' : ''}`}>
                
                {/* Retracting Fluid Core */}
                <div 
                    className="absolute top-0 left-0 h-full rounded-full flex items-center pr-3 overflow-hidden shadow-[inset_0_-2px_8px_rgba(0,0,0,0.6)]"
                    style={{
                        width: `${progress}%`,
                        background: hasScoreMultiplier 
                            ? 'linear-gradient(90deg, rgba(234,88,12,0.8), rgba(251,146,60,0.9))' 
                            : `linear-gradient(90deg, ${multiplierColor}60 0%, ${multiplierColor}cc 100%)`,
                        boxShadow: `0 0 15px ${hasScoreMultiplier ? '#f97316' : multiplierColor}`
                    }}
                >
                    <div className="ml-auto w-1 h-3/4 rounded-full bg-white animate-pulse shadow-[0_0_5px_white]" />
                </div>

                {/* Normal High-Precision Text Overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 font-mono tracking-widest text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
                    <div className="text-sm md:text-base font-black uppercase text-shadow">
                        {displayMultiplier.toFixed(4)}x {hasScoreMultiplier && <span className="text-orange-400 ml-1 text-[10px] tracking-normal mb-1 inline-block drop-shadow-md">(OVERCLOCKED)</span>}
                    </div>
                </div>
            </div>
            
            <div className="mt-1 flex justify-between w-full px-2 font-mono">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Min: {taMin.toFixed(1)}x</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Max: {taMax.toFixed(1)}x</span>
            </div>
        </div>
    );
}
