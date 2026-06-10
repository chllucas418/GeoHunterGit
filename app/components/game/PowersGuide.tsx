import { useState, useRef, useEffect } from "react";

interface Power {
    id: string;
    name: string;
    cost: number;
    emoji: string;
    type: "offensive" | "defensive";
    description: string;
}

const ALL_POWERS: Power[] = [
    // Offensive
    { id: "gps_scrambler", name: "Scramble", cost: 30, emoji: "🗺️", type: "offensive", description: "Jumbles opponent's map controls. Hit them to confuse!" },
    { id: "intel_corruptor", name: "Corrupt", cost: 50, emoji: "👾", type: "offensive", description: "Scrambles opponent's clue boxes. Reduce their intel!" },
    { id: "emp_blackout", name: "EMP", cost: 80, emoji: "⚡", type: "offensive", description: "Blacks out opponent's screen temporarily." },
    { id: "multiplier_leech", name: "Leech", cost: 100, emoji: "🧛", type: "offensive", description: "Steals multiplier from the top player. Bold move!" },
    // Defensive
    { id: "aegis_reflection", name: "Aegis", cost: 60, emoji: "🛡️", type: "defensive", description: "Blocks the next attack against you. Shield up!" },
    { id: "chrono_freeze", name: "Freeze", cost: 120, emoji: "❄️", type: "defensive", description: "Pauses your score multiplier decay. Save your bonus!" },
    { id: "quantum_triangulation", name: "Triangulate", cost: 160, emoji: "🎯", type: "defensive", description: "Reveals a 500m target zone. Narrow it down!" },
    { id: "ironclad_lockdown", name: "Ironclad", cost: 200, emoji: "🔒", type: "defensive", description: "Max multiplier on your next submit. Go big!" },
];

interface PowersGuideProps {
    availablePowers: { offensive: string[]; defensive: string[] };
    onDismiss: () => void;
}

export function PowersGuide({ availablePowers, onDismiss }: PowersGuideProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const touchStartXRef = useRef<number | null>(null);
    const touchStartYRef = useRef<number | null>(null);

    // Filter to only show powers the player actually has
    const allPowerIds = [...availablePowers.offensive, ...availablePowers.defensive];
    const availablePowerList = ALL_POWERS.filter(p => allPowerIds.includes(p.id));

    if (availablePowerList.length === 0) {
        return null;
    }

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (touchStartXRef.current === null || touchStartYRef.current === null) return;

        const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
        const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;

        // Only swipe if horizontal movement > vertical movement (intentional swipe, not scroll)
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
            if (deltaX < 0 && currentIndex < availablePowerList.length - 1) {
                // Swipe left → next
                setCurrentIndex(prev => prev + 1);
            } else if (deltaX > 0 && currentIndex > 0) {
                // Swipe right → previous
                setCurrentIndex(prev => prev - 1);
            }
        }

        touchStartXRef.current = null;
        touchStartYRef.current = null;
    };

    const currentPower = availablePowerList[currentIndex];
    const isLastCard = currentIndex === availablePowerList.length - 1;
    const isFirstCard = currentIndex === 0;

    return (
        <div
            className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-2xl flex flex-col items-center justify-center p-4 md:p-8 animate-in fade-in zoom-in-95 duration-300"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="text-center mb-6">
                <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-widest mb-2">⚡ Your Powers</h2>
                <p className="text-sm text-slate-400 font-medium">
                    {availablePowerList.length} abilities available — swipe to explore
                </p>
            </div>

            {/* Swipe instruction */}
            <div className="flex items-center gap-2 mb-4 text-slate-500">
                <span className="text-xl">👆</span>
                <span className="text-xs font-mono uppercase tracking-widest">Swipe to browse</span>
            </div>

            {/* Power Card */}
            <div className="w-full max-w-sm">
                <div
                    className={`relative p-6 rounded-3xl border-2 backdrop-blur-xl transition-all duration-300
                        ${currentPower.type === "offensive"
                            ? "bg-red-500/10 border-red-500/40"
                            : "bg-blue-500/10 border-blue-500/40"
                        }`}
                >
                    {/* Type Badge */}
                    <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest
                        ${currentPower.type === "offensive" ? "bg-red-500 text-white" : "bg-blue-500 text-white"}`}>
                        {currentPower.type === "offensive" ? "⚔️ Offensive" : "🛡️ Defensive"}
                    </div>

                    {/* Emoji Icon */}
                    <div className="text-6xl text-center mb-4">{currentPower.emoji}</div>

                    {/* Name & Cost */}
                    <div className="text-center mb-3">
                        <h3 className="text-2xl font-black text-white mb-1">{currentPower.name}</h3>
                        <div className="inline-flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 px-3 py-1 rounded-full">
                            <span className="text-yellow-400 font-black text-sm">{currentPower.cost}</span>
                            <span className="text-yellow-400/60 text-xs font-mono">⚡</span>
                        </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-slate-300 text-center leading-relaxed">{currentPower.description}</p>

                    {/* Cast instruction */}
                    <div className="mt-4 flex justify-center">
                        <div className="bg-white/10 border border-white/20 px-4 py-2 rounded-full text-xs font-black text-white/80 uppercase tracking-widest">
                            Double-tap action bar to cast
                        </div>
                    </div>
                </div>
            </div>

            {/* Progress dots */}
            <div className="flex items-center gap-2 mt-6 mb-8">
                {availablePowerList.map((_, i) => (
                    <div
                        key={i}
                        className={`h-2 rounded-full transition-all duration-300 ${i === currentIndex ? "w-6 bg-blue-400" : "w-2 bg-white/20"}`}
                    />
                ))}
            </div>

            {/* Navigation + Dismiss */}
            <div className="flex items-center gap-4 w-full max-w-sm">
                {/* Prev button */}
                <button
                    onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                    disabled={isFirstCard}
                    className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg transition-all
                        ${isFirstCard
                            ? "border-white/10 text-white/20 cursor-not-allowed"
                            : "border-white/30 text-white hover:bg-white/10 hover:scale-105 active:scale-95"
                        }`}
                >
                    ←
                </button>

                {/* Skip + Got it */}
                <div className="flex-1 flex gap-2">
                    <button
                        onClick={onDismiss}
                        className="flex-1 py-3 bg-white/10 border border-white/20 rounded-xl text-xs font-bold text-white/60 uppercase tracking-widest hover:bg-white/20 transition-all"
                    >
                        Skip
                    </button>
                    <button
                        onClick={onDismiss}
                        className="flex-1 py-3 bg-blue-600 rounded-xl text-xs font-black text-white uppercase tracking-widest hover:bg-blue-500 transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                    >
                        {isLastCard ? "Got it! 🚀" : "Next"}
                    </button>
                </div>

                {/* Next button */}
                <button
                    onClick={() => setCurrentIndex(prev => Math.min(availablePowerList.length - 1, prev + 1))}
                    disabled={isLastCard}
                    className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg transition-all
                        ${isLastCard
                            ? "border-white/10 text-white/20 cursor-not-allowed"
                            : "border-white/30 text-white hover:bg-white/10 hover:scale-105 active:scale-95"
                        }`}
                >
                    →
                </button>
            </div>
        </div>
    );
}