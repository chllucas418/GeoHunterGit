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

    // Atlas gauge colors — warm amber gradient
    const barColor = hasScoreMultiplier
        ? 'linear-gradient(90deg, #d4822a 0%, #f5a84a 100%)'
        : displayMultiplier > 1.5
            ? 'linear-gradient(90deg, #4a9b8c 0%, #7ec8ba 100%)'
            : displayMultiplier > 1.0
                ? 'linear-gradient(90deg, #c9a84c 0%, #e8d48b 100%)'
                : 'linear-gradient(90deg, #b7472a 0%, #d4724a 100%)';

    const barGlow = hasScoreMultiplier ? '#f5a84a'
        : displayMultiplier > 1.5 ? '#7ec8ba'
            : displayMultiplier > 1.0 ? '#e8d48b'
                : '#d4724a';

    return (
        <div className="flex flex-col items-center pointer-events-none w-full">
            {/* Grace Period Lock Indicator */}
            {graceRemaining > 0 && (
                <div className="mb-2 bg-teal/15 border border-teal/40 text-teal px-4 py-0.5 rounded text-[10px] uppercase font-black tracking-widest backdrop-blur-md">
                    Multiplier Locked: {graceRemaining.toFixed(1)}s
                </div>
            )}

            {/* Brass Gauge Bar */}
            <div className={`w-full bg-[#0e1a14]/80 backdrop-blur-xl rounded border border-brass/20 h-8 relative overflow-hidden shadow-[inset_0_2px_8px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.4)] ${hasScoreMultiplier ? 'ring-1 ring-amber/50' : ''}`}>
                {/* Tick marks */}
                <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                    {[...Array(11)].map((_, i) => (
                        <div key={i} className="h-full w-px bg-[#0e1a14]/40" style={{ opacity: i % 5 === 0 ? 0.8 : 0.3 }} />
                    ))}
                </div>

                {/* Retracting Brass Core */}
                <div
                    className="absolute top-0 left-0 h-full flex items-center overflow-hidden"
                    style={{
                        width: `${progress}%`,
                        background: barColor,
                        boxShadow: `0 0 12px ${barGlow}`
                    }}
                >
                    <div className="ml-auto w-1 h-3/4 rounded-full bg-cream/90 shadow-[0_0_5px_rgba(245,240,232,0.8)]" />
                </div>

                {/* Multiplier Readout */}
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 font-mono tracking-widest text-cream drop-shadow-[0_1px_3px_rgba(0,0,0,1)]">
                    <div className="text-sm md:text-base font-black uppercase">
                        {displayMultiplier.toFixed(4)}x {hasScoreMultiplier && <span className="text-amber ml-1 text-[10px] tracking-normal mb-0.5 inline-block">(Overclocked)</span>}
                    </div>
                </div>
            </div>

            {/* Range Labels */}
            <div className="mt-1 flex justify-between w-full px-2 font-mono text-[9px]">
                <span className="font-bold text-rust/70 uppercase tracking-widest">Min: {taMin.toFixed(1)}x</span>
                <span className="font-bold text-teal/70 uppercase tracking-widest">Max: {taMax.toFixed(1)}x</span>
            </div>
        </div>
    );
}