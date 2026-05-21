export function Compass({ showCompass, location, mapInstance }: any) {
    if (!showCompass || !location) return null;

    return (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none">
            <div className="w-52 h-52 md:w-64 md:h-64 rounded-full border-2 border-emerald-500/60 bg-black/70 backdrop-blur-xl relative flex items-center justify-center"
                 style={{ animation: 'compassPulse 1.5s ease-in-out infinite' }}>
                {/* Concentric Rings */}
                <div className="absolute w-3/4 h-3/4 rounded-full border border-emerald-500/20" />
                <div className="absolute w-1/2 h-1/2 rounded-full border border-emerald-500/20" />
                <div className="absolute w-1/4 h-1/4 rounded-full border border-emerald-500/20" />
                {/* Cross-hairs */}
                <div className="absolute w-full h-[1px] bg-emerald-500/15" />
                <div className="absolute w-[1px] h-full bg-emerald-500/15" />
                {/* Sweeping Radar Arm */}
                <div className="absolute w-1/2 h-[2px] bg-gradient-to-r from-emerald-400/60 to-transparent origin-left"
                     style={{ animation: 'compassSweep 2s linear infinite' }} />
                {/* Directional Needle — originates from center, points toward target */}
                <div className="absolute w-1.5 h-1/2 origin-bottom rounded-t-full"
                     style={{
                         background: 'linear-gradient(to top, #34d399, #10b981)',
                         boxShadow: '0 0 15px #34d399, 0 0 30px rgba(52,211,153,0.4)',
                         bottom: '50%',
                         left: 'calc(50% - 3px)',
                         transform: `rotate(${(() => {
                             if (!mapInstance) return 0;
                             const center = mapInstance.getCenter();
                             if (!center) return 0;
                             const dy = location.lat - center.lat();
                             const dx = location.lng - center.lng();
                             return Math.atan2(dx, dy) * (180 / Math.PI);
                         })()}deg)`
                     }}
                />
                {/* Cardinal Labels */}
                <span className="absolute top-2 text-[9px] font-bold text-emerald-300/60 tracking-widest">N</span>
                <span className="absolute bottom-2 text-[9px] font-bold text-emerald-300/40 tracking-widest">S</span>
                <span className="absolute right-3 text-[9px] font-bold text-emerald-300/40 tracking-widest">E</span>
                <span className="absolute left-3 text-[9px] font-bold text-emerald-300/40 tracking-widest">W</span>
                {/* Center Dot */}
                <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399,0_0_20px_rgba(52,211,153,0.5)] z-10 relative" />
            </div>
            {/* Label */}
            <div className="text-center mt-3">
                <div className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em]">Target Compass</div>
                <div className="text-[9px] text-emerald-300/50 font-mono">3s Active</div>
            </div>
        </div>
    );
}
