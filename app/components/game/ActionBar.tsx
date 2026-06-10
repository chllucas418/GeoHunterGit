const SUPERPOWER_DESCRIPTIONS: Record<string, string> = {
    'gps_scrambler': 'Inverts opponent map controls. Tap again to cast!',
    'intel_corruptor': 'Scrambles opponent evidence. Tap again to cast!',
    'emp_blackout': 'Full-screen blindness. Tap again to cast!',
    'multiplier_leech': 'Steals multiplier from top player. Tap again to cast!',
    'aegis_reflection': 'Reflects the next attack back. Tap again to cast!',
    'chrono_freeze': 'Pauses your score multiplier decay. Tap again to cast!',
    'quantum_triangulation': 'Reveals a 500m target zone. Tap again to cast!',
    'ironclad_lockdown': 'Max multiplier on next submit. Tap again to cast!'
};

export function ActionBar({
    room, submitted, previewPowerId, localEnergy, availablePowers,
    hasAegis, hasChronoFreeze, quantumCircle, hasIroncladLockdown,
    handlePowerTap, activatePower, activateSelfBuff
}: any) {
    if (room.status !== 'PLAYING' || submitted) return null;

    return (
        <div className="absolute bottom-10 md:bottom-6 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 w-[95%] sm:w-auto">
            {/* Tooltip for Double Tap */}
            {previewPowerId && (
                <div className="bg-slate-900/95 backdrop-blur-xl border border-yellow-500/50 text-white text-[10px] sm:text-xs font-bold px-4 py-2 rounded-full shadow-[0_0_20px_rgba(234,179,8,0.4)] animate-bounce relative uppercase tracking-widest text-center">
                    {SUPERPOWER_DESCRIPTIONS[previewPowerId]}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-solid border-t-slate-900/95 border-t-6 border-x-transparent border-x-6 border-b-0"></div>
                </div>
            )}

            <div id="action-bar" className="flex w-full sm:w-auto items-center gap-4 bg-slate-950/90 backdrop-blur-2xl border border-white/10 px-6 py-3 rounded-full shadow-[0_0_40px_rgba(0,0,0,0.8)] border-b-4 border-b-slate-800">
                <div className="flex flex-col items-center border-r border-white/20 pr-4">
                    <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest drop-shadow-[0_0_10px_rgba(234,179,8,0.8)]">Energy</span>
                    <span className="text-xl font-black font-mono text-yellow-400">{localEnergy}/200</span>
                </div>
                
                <div className="grid grid-cols-4 sm:flex sm:flex-wrap md:flex-nowrap gap-1 md:gap-2 justify-center max-h-[140px] overflow-y-auto pr-1">
                    {/* OFFENSIVE */}
                    {availablePowers.offensive.includes('gps_scrambler') && (
                        <button 
                            disabled={localEnergy < 30} title="Scramble Map"
                            onClick={() => handlePowerTap('gps_scrambler', 30, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 30 ? (previewPowerId === 'gps_scrambler' ? 'bg-indigo-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(99,102,241,0.8)]' : 'bg-indigo-600/80 hover:bg-indigo-500 text-white border-indigo-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🗺️</span> Scramble(30)
                        </button>
                    )}
                    {availablePowers.offensive.includes('intel_corruptor') && (
                        <button 
                            disabled={localEnergy < 50} title="Intel Corruptor"
                            onClick={() => handlePowerTap('intel_corruptor', 50, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 50 ? (previewPowerId === 'intel_corruptor' ? 'bg-purple-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(168,85,247,0.8)]' : 'bg-purple-600/80 hover:bg-purple-500 text-white border-purple-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">👾</span> Corrupt(50)
                        </button>
                    )}
                    {availablePowers.offensive.includes('emp_blackout') && (
                        <button 
                            disabled={localEnergy < 80} title="EMP Blackout"
                            onClick={() => handlePowerTap('emp_blackout', 80, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 80 ? (previewPowerId === 'emp_blackout' ? 'bg-slate-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(100,116,139,0.8)]' : 'bg-slate-700/80 hover:bg-slate-600 text-white border-slate-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">⚡</span> EMP(80)
                        </button>
                    )}
                    {availablePowers.offensive.includes('multiplier_leech') && (
                        <button 
                            disabled={localEnergy < 100} title="Multiplier Leech"
                            onClick={() => handlePowerTap('multiplier_leech', 100, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 100 ? (previewPowerId === 'multiplier_leech' ? 'bg-rose-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(244,63,94,0.8)]' : 'bg-rose-600/80 hover:bg-rose-500 text-white border-rose-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🧛</span> Leech(100)
                        </button>
                    )}
                    
                    {/* DEFENSIVE */}
                    {availablePowers.defensive.includes('aegis_reflection') && (
                        <button 
                            disabled={localEnergy < 60 || hasAegis} title="Aegis Reflection"
                            onClick={() => handlePowerTap('aegis_reflection', 60, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 60 && !hasAegis ? (previewPowerId === 'aegis_reflection' ? 'bg-cyan-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(6,182,212,0.8)]' : 'bg-cyan-600/80 hover:bg-cyan-500 text-white border-cyan-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🛡️</span> Aegis(60)
                        </button>
                    )}
                    {availablePowers.defensive.includes('chrono_freeze') && (
                        <button 
                            disabled={localEnergy < 120 || hasChronoFreeze} title="Chrono Freeze"
                            onClick={() => handlePowerTap('chrono_freeze', 120, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 120 && !hasChronoFreeze ? (previewPowerId === 'chrono_freeze' ? 'bg-blue-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(59,130,246,0.8)]' : 'bg-blue-600/80 hover:bg-blue-500 text-white border-blue-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">❄️</span> Freeze(120)
                        </button>
                    )}
                    {availablePowers.defensive.includes('quantum_triangulation') && (
                        <button 
                            disabled={localEnergy < 160 || !!quantumCircle} title="Quantum Triangulation"
                            onClick={() => handlePowerTap('quantum_triangulation', 160, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 160 && !quantumCircle ? (previewPowerId === 'quantum_triangulation' ? 'bg-emerald-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-emerald-600/80 hover:bg-emerald-500 text-white border-emerald-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🎯</span> Triang.(160)
                        </button>
                    )}
                    {availablePowers.defensive.includes('ironclad_lockdown') && (
                        <button 
                            disabled={localEnergy < 200 || hasIroncladLockdown} title="Ironclad Lockdown"
                            onClick={() => handlePowerTap('ironclad_lockdown', 200, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded-xl font-bold text-[8px] md:text-[9px] uppercase transition-all shadow-lg border flex flex-col items-center flex-1 ${localEnergy >= 200 && !hasIroncladLockdown ? (previewPowerId === 'ironclad_lockdown' ? 'bg-yellow-500 text-white border-white scale-110 shadow-[0_0_15px_rgba(234,179,8,0.8)]' : 'bg-yellow-600/80 hover:bg-yellow-500 text-white border-yellow-400 hover:scale-105 active:scale-95') : 'bg-slate-800 text-slate-500 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🔒</span> Ironclad(200)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
