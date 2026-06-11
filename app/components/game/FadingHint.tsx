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
        const timer = setTimeout(() => {
            setVisible(false);
        }, 12000);

        return () => clearTimeout(timer);
    }, [hint]);

    if (!visible) return null;

    return (
        <div
            className={`relative group bg-[#0e1a14]/90 backdrop-blur-xl border p-3.5 rounded-r rounded-bl-xl text-xs shadow-[0_4px_20px_rgba(0,0,0,0.5)] hint-fade-card pointer-events-auto transition-all duration-300 ${
                isIntelCorrupted
                    ? "border-rust/60 bg-[#1a1a18]/80"
                    : "border-teal/40"
            }`}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5 pr-6">
                <div className="flex items-center gap-1.5">
                    <span className={`relative flex h-2 w-2`}>
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isIntelCorrupted ? 'bg-rust' : 'bg-teal'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${isIntelCorrupted ? 'bg-rust' : 'bg-teal'}`}></span>
                    </span>
                    <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${isIntelCorrupted ? 'text-rust' : 'text-teal'}`}>
                        {isIntelCorrupted ? (
                            "System Malfunction"
                        ) : (
                            totalHints
                                ? `Signal #0${index + 1} / 0${totalHints}`
                                : `Signal #0${index + 1}`
                        )}
                    </span>
                </div>
            </div>

            {/* Dismiss */}
            <button
                onClick={() => setVisible(false)}
                className="absolute top-2.5 right-2.5 text-stone/40 hover:text-cream/90 bg-white/5 hover:bg-white/10 w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold transition-all duration-200 cursor-pointer"
                title="Dismiss"
            >
                ✕
            </button>

            {/* Content */}
            <div className="leading-relaxed text-stone-light">
                {isIntelCorrupted ? (
                    <span className="font-mono text-rust/80 font-bold tracking-widest line-through decoration-wavy">
                        ████ ENCRYPTED: PAYLOAD CORRUPTED ████
                    </span>
                ) : (
                    hint
                )}
            </div>
        </div>
    );
}