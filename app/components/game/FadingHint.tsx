import { useState, useEffect } from "react";

interface FadingHintProps {
    hint: string;
    index: number;
    totalHints?: number;
    isIntelCorrupted?: boolean;
}

export function FadingHint({ hint, index, totalHints, isIntelCorrupted }: FadingHintProps) {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        // Automatically hide the hint completely after 12 seconds
        const timer = setTimeout(() => {
            setVisible(false);
        }, 12000); // 12 seconds total duration (matches css animation duration)

        return () => clearTimeout(timer);
    }, [hint]);

    if (!visible) return null;

    return (
        <div
            className={`relative group bg-black/65 backdrop-blur-xl border border-white/10 p-3.5 rounded-r-xl rounded-bl-xl border-l-4 ${
                isIntelCorrupted
                    ? "border-l-purple-600 bg-purple-950/50"
                    : "border-l-yellow-400"
            } text-xs font-medium text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] hint-fade-card pointer-events-auto transition-all duration-300`}
        >
            {/* Header / Meta */}
            <div className="flex items-center justify-between mb-1.5 pr-6">
                <div className="flex items-center gap-1.5">
                    {/* Pulsing indicator */}
                    <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isIntelCorrupted ? 'bg-purple-400' : 'bg-yellow-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${isIntelCorrupted ? 'bg-purple-500' : 'bg-yellow-500'}`}></span>
                    </span>
                    <span className={`text-[10px] font-black tracking-widest uppercase ${isIntelCorrupted ? 'text-purple-400' : 'text-yellow-400'}`}>
                        {isIntelCorrupted ? (
                            "SYSTEM MALFUNCTION"
                        ) : (
                            totalHints 
                                ? `Transmission #0${index + 1} / 0${totalHints}` 
                                : `Transmission #0${index + 1}`
                        )}
                    </span>
                </div>
            </div>

            {/* Manual Dismiss Button */}
            <button
                onClick={() => setVisible(false)}
                className="absolute top-2.5 right-2.5 text-white/40 hover:text-white/90 bg-white/5 hover:bg-white/10 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all duration-200 cursor-pointer"
                title="Dismiss Hint"
            >
                ✕
            </button>

            {/* Hint Content */}
            <div className="leading-relaxed">
                {isIntelCorrupted ? (
                    <span className="font-mono text-purple-300 font-bold tracking-widest line-through decoration-wavy opacity-90 blur-[0.5px]">
                        👾 ████ ENCRYPTED: PAYLOAD CORRUPTED ████
                    </span>
                ) : (
                    hint
                )}
            </div>
        </div>
    );
}
