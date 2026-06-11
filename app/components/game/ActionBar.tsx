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
                <div className="bg-[#0e1a14]/95 backdrop-blur-xl border border-brass/50 text-cream text-[10px] sm:text-xs font-bold px-4 py-2 rounded shadow-[0_0_20px_rgba(201,168,76,0.2)] animate-bounce relative uppercase tracking-widest text-center">
                    {SUPERPOWER_DESCRIPTIONS[previewPowerId]}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-solid border-t-[#0e1a14]/95 border-t-6 border-x-transparent border-x-6 border-b-0"></div>
                </div>
            )}

            {/* Atlas Brass Control Bar */}
            <div id="action-bar" className="flex w-full sm:w-auto items-center gap-4 bg-[#0e1a14]/95 backdrop-blur-2xl border border-brass/20 px-5 py-2.5 rounded-sm shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(201,168,76,0.08)]">
                {/* Energy Gauge */}
                <div className="flex flex-col items-center border-r border-brass/20 pr-4">
                    <span className="text-[9px] font-bold text-brass uppercase tracking-[0.2em] drop-shadow-[0_0_8px_rgba(201,168,76,0.5)]">Energy</span>
                    <span className="font-mono text-xl font-bold text-brass-light">{localEnergy}/200</span>
                </div>

                <div className="grid grid-cols-4 sm:flex sm:flex-wrap md:flex-nowrap gap-1 md:gap-2 justify-center max-h-[140px] overflow-y-auto pr-1">
                    {/* OFFENSIVE */}
                    {availablePowers.offensive.includes('gps_scrambler') && (
                        <button
                            disabled={localEnergy < 30}
                            title="Scramble Map"
                            onClick={() => handlePowerTap('gps_scrambler', 30, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 30 ? (previewPowerId === 'gps_scrambler' ? 'bg-indigo-800 text-white border-indigo-400 scale-110 shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-[#1e2d4a]/80 hover:bg-[#243460] text-stone-light border-indigo-900/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🗺️</span> Scramble(30)
                        </button>
                    )}
                    {availablePowers.offensive.includes('intel_corruptor') && (
                        <button
                            disabled={localEnergy < 50}
                            title="Intel Corruptor"
                            onClick={() => handlePowerTap('intel_corruptor', 50, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 50 ? (previewPowerId === 'intel_corruptor' ? 'bg-purple-800 text-white border-purple-400 scale-110 shadow-[0_0_15px_rgba(168,85,247,0.5)]' : 'bg-[#2d1f3d]/80 hover:bg-[#3a2850] text-stone-light border-purple-900/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">👾</span> Corrupt(50)
                        </button>
                    )}
                    {availablePowers.offensive.includes('emp_blackout') && (
                        <button
                            disabled={localEnergy < 80}
                            title="EMP Blackout"
                            onClick={() => handlePowerTap('emp_blackout', 80, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 80 ? (previewPowerId === 'emp_blackout' ? 'bg-stone-600 text-white border-stone-400 scale-110 shadow-[0_0_15px_rgba(100,116,139,0.5)]' : 'bg-[#1e2320]/80 hover:bg-[#28302b] text-stone-light border-stone-800/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">⚡</span> EMP(80)
                        </button>
                    )}
                    {availablePowers.offensive.includes('multiplier_leech') && (
                        <button
                            disabled={localEnergy < 100}
                            title="Multiplier Leech"
                            onClick={() => handlePowerTap('multiplier_leech', 100, activatePower)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 100 ? (previewPowerId === 'multiplier_leech' ? 'bg-rose-800 text-white border-rose-400 scale-110 shadow-[0_0_15px_rgba(244,63,94,0.5)]' : 'bg-[#2d1a1f]/80 hover:bg-[#3a2228] text-stone-light border-rose-900/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🧛</span> Leech(100)
                        </button>
                    )}

                    {/* DEFENSIVE */}
                    {availablePowers.defensive.includes('aegis_reflection') && (
                        <button
                            disabled={localEnergy < 60 || hasAegis}
                            title="Aegis Reflection"
                            onClick={() => handlePowerTap('aegis_reflection', 60, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 60 && !hasAegis ? (previewPowerId === 'aegis_reflection' ? 'bg-cyan-800 text-white border-cyan-400 scale-110 shadow-[0_0_15px_rgba(6,182,212,0.5)]' : 'bg-[#1a2d2f]/80 hover:bg-[#223a3f] text-stone-light border-cyan-900/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🛡️</span> Aegis(60)
                        </button>
                    )}
                    {availablePowers.defensive.includes('chrono_freeze') && (
                        <button
                            disabled={localEnergy < 120 || hasChronoFreeze}
                            title="Chrono Freeze"
                            onClick={() => handlePowerTap('chrono_freeze', 120, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 120 && !hasChronoFreeze ? (previewPowerId === 'chrono_freeze' ? 'bg-teal text-cream border-teal-light scale-110 shadow-[0_0_15px_rgba(74,155,140,0.5)]' : 'bg-[#1a3a2f]/80 hover:bg-[#234a3f] text-stone-light border-teal/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">❄️</span> Freeze(120)
                        </button>
                    )}
                    {availablePowers.defensive.includes('quantum_triangulation') && (
                        <button
                            disabled={localEnergy < 160 || !!quantumCircle}
                            title="Quantum Triangulation"
                            onClick={() => handlePowerTap('quantum_triangulation', 160, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 160 && !quantumCircle ? (previewPowerId === 'quantum_triangulation' ? 'bg-emerald-800 text-white border-emerald-400 scale-110 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-[#1a2d27]/80 hover:bg-[#224035] text-stone-light border-emerald-900/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🎯</span> Triang.(160)
                        </button>
                    )}
                    {availablePowers.defensive.includes('ironclad_lockdown') && (
                        <button
                            disabled={localEnergy < 200 || hasIroncladLockdown}
                            title="Ironclad Lockdown"
                            onClick={() => handlePowerTap('ironclad_lockdown', 200, activateSelfBuff)}
                            className={`px-1 py-1 md:px-3 md:py-2 rounded font-bold text-[8px] md:text-[9px] uppercase transition-all border flex flex-col items-center flex-1 ${localEnergy >= 200 && !hasIroncladLockdown ? (previewPowerId === 'ironclad_lockdown' ? 'bg-amber text-charcoal border-amber-light scale-110 shadow-[0_0_15px_rgba(212,130,42,0.5)]' : 'bg-[#2d2510]/80 hover:bg-[#3a3215] text-stone-light border-amber/50 hover:scale-105 active:scale-95') : 'bg-[#1a1a18] text-stone/40 border-transparent cursor-not-allowed'}`}
                        >
                            <span className="text-base md:text-xl mb-0.5">🔒</span> Ironclad(200)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}