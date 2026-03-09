import { Link } from "react-router";

export default function PrivacyPolicy() {
    return (
        <div className="min-h-screen bg-[#0c0f17] text-slate-100 p-6 md:p-12 lg:p-24 relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-[-10%] left-[-10%] w-[1000px] h-[1000px] bg-blue-600/5 rounded-full blur-[200px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[1000px] h-[1000px] bg-indigo-600/5 rounded-full blur-[200px] pointer-events-none" />

            <div className="max-w-5xl mx-auto relative z-10">
                <header className="mb-20 border-b border-white/5 pb-16">
                    <Link to="/" className="inline-block mb-10 px-6 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-[0.4em] text-white/60 transition-all">
                        ← RETURN TO SYSTEM INTERFACE
                    </Link>
                    <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-glow mb-8 text-white leading-[0.9]">
                        GLOBAL <br/>
                        <span className="text-white/40">INSTRUMENT</span>
                    </h1>
                    <div className="flex flex-wrap gap-6 text-[10px] font-mono uppercase tracking-[0.2em] text-blue-200/30">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>PROTOCOL VERSION 6.0.0</span>
                        </div>
                        <span className="opacity-20">|</span>
                        <span>COMPLIANCE: GLOBAL (GDPR, CCPA, PDPO)</span>
                        <span className="opacity-20">|</span>
                        <span>EFFECTIVE: 2026.03.10</span>
                    </div>
                </header>

                <div className="grid lg:grid-cols-12 gap-16">
                    {/* Navigation Sidebar */}
                    <aside className="lg:col-span-3 hidden lg:block sticky top-12 h-fit space-y-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-6">Navigation Index</p>
                        <nav className="flex flex-col gap-4 text-[10px] font-bold uppercase tracking-widest">
                            <a href="#tos" className="text-blue-400 hover:text-white transition-colors">01. Terms of Use</a>
                            <a href="#privacy" className="text-white/40 hover:text-white transition-colors">02. Universal Privacy</a>
                            <a href="#rights" className="text-white/40 hover:text-white transition-colors">03. International Rights</a>
                            <a href="#eula" className="text-white/40 hover:text-white transition-colors">04. Global EULA</a>
                        </nav>
                    </aside>

                    {/* Main Content Area */}
                    <div className="lg:col-span-9 space-y-40">
                        
                        {/* 1. Global Terms of Service */}
                        <section id="tos" className="scroll-mt-24 space-y-12">
                            <div className="flex items-center gap-6">
                                <span className="text-5xl font-black text-white/5 italic select-none">01</span>
                                <h2 className="text-3xl font-black uppercase tracking-[0.3em] text-white">UNIVERSAL TERMS OF SERVICE</h2>
                            </div>
                            
                            <div className="glass-panel p-10 md:p-16 rounded-[4rem] border border-white/10 bg-black/60 space-y-12 text-slate-400 text-sm leading-relaxed text-left">
                                <div className="space-y-6">
                                    <h3 className="font-black text-white uppercase tracking-widest text-xs">1.1 GLOBAL ACCEPTANCE</h3>
                                    <p>By accessing the GeoHunter protocol, the User irrevocably agrees to be bound by these Terms, which constitute a master legal agreement enforceable in any jurisdiction globally. Utilization across any border signifies acceptance of these unified standards.</p>
                                </div>

                                <div className="space-y-6">
                                    <h3 className="font-black text-white uppercase tracking-widest text-xs">1.2 SOVEREIGN ACCOUNT CONTROL</h3>
                                    <p>The site owner ("the owner of GeoHunter") maintains absolute authority over the Agent Hierarchy. Accounts may be deactivated, purged, or restricted globally at the site owner's sole discretion to maintain network integrity or respond to multi-jurisdictional legal requirements.</p>
                                </div>

                                <div className="space-y-6 p-8 bg-blue-500/5 rounded-3xl border border-blue-500/10">
                                    <h3 className="font-black text-blue-400 uppercase tracking-widest text-xs mb-4">1.3 INTERNATIONAL ASSET TRANSFER (SMKMCF)</h3>
                                    <p>All visual assets originally submitted by students of SMKMCF Ma Ko Pan Memorial College (Form 2) are subject to a **PERPETUAL GLOBAL TRANSFER OF OWNERSHIP**. By agreeing to these Terms, all moral and intellectual property rights are irrevocably assigned to the site owner in every territory recognized by international law. The site owner retains unlimited rights to synthesize, deploy, and monetize these assets globally.</p>
                                </div>

                                <div className="space-y-6 border-t border-white/5 pt-6">
                                    <h3 className="font-black text-white uppercase tracking-widest text-xs">1.4 GLOBAL LIMITATION OF LIABILITY</h3>
                                    <p>To the fullest extent permitted by applicable law in any territory, the site owner shall not be held liable for any data synthesis errors, network disruptions, or pedagogical losses. The platform is provided "AS-IS" globally.</p>
                                </div>
                            </div>
                        </section>

                        {/* 2. Universal Privacy Strategy */}
                        <section id="privacy" className="scroll-mt-24 space-y-12">
                            <div className="flex items-center gap-6">
                                <span className="text-5xl font-black text-white/5 italic select-none">02</span>
                                <h2 className="text-3xl font-black uppercase tracking-[0.3em] text-white">UNIVERSAL PRIVACY POLICY</h2>
                            </div>
                            
                            <div className="glass-panel p-10 md:p-16 rounded-[4rem] border border-white/10 bg-black/60 space-y-12 text-slate-400 text-sm leading-relaxed text-left">
                                <div className="grid md:grid-cols-2 gap-12">
                                    <div className="space-y-6">
                                        <h3 className="font-black text-white uppercase tracking-widest text-xs">DATA CRYSTALLIZATION</h3>
                                        <p>We collect PII (Name, Email), Telemetry (IP, Cookies), and Tactical Assets (Geodata). This is processed for Contractual Performance and Legitimate Interests as defined by global standards (GDPR Art. 6).</p>
                                    </div>
                                    <div className="space-y-6">
                                        <h3 className="font-black text-white uppercase tracking-widest text-xs">GLOBAL RESIDENCY</h3>
                                        <p>Data is distributed across the **Cloudflare Global Edge Network**, ensuring low-latency persistence and compliance with regional data residency requirements while maintaining a centralized master ledger.</p>
                                    </div>
                                </div>

                                <div className="space-y-6 pt-6 border-t border-white/5">
                                    <h3 className="font-black text-white uppercase tracking-widest text-xs">NEURAL PROCESSING SAFEGUARDS</h3>
                                    <p>AI tactical analysis (Google Gemini Business) is conducted under Enterprise-only protocols. No user data is leaked into the public neural training sets. Your data is isolated and protected by high-entropy encryption at rest and in transit.</p>
                                </div>
                            </div>
                        </section>

                        {/* 3. International User Rights */}
                        <section id="rights" className="scroll-mt-24 space-y-12">
                            <div className="flex items-center gap-6">
                                <span className="text-5xl font-black text-white/5 italic select-none">03</span>
                                <h2 className="text-3xl font-black uppercase tracking-[0.3em] text-white">INTERNATIONAL RIGHTS PROTECTIONS</h2>
                            </div>
                            
                            <div className="glass-panel p-10 md:p-16 rounded-[4rem] border border-white/10 bg-black/60 space-y-12 text-slate-400 text-sm leading-relaxed text-left">
                                <div className="grid md:grid-cols-3 gap-8 text-center md:text-left">
                                    <div className="p-6 bg-white/5 rounded-3xl space-y-4">
                                        <h4 className="font-black text-blue-400 text-[10px] tracking-widest uppercase">EU/GDPR</h4>
                                        <p className="text-[11px] opacity-60">Complete Right to Erasure, Portability, and Object to Processing. Right to be forgotten is absolute within the EU territory.</p>
                                    </div>
                                    <div className="p-6 bg-white/5 rounded-3xl space-y-4">
                                        <h4 className="font-black text-emerald-400 text-[10px] tracking-widest uppercase">US/CCPA</h4>
                                        <p className="text-[11px] opacity-60">Right to Opt-Out of data sales (we do not sell data), Right to Know, and Right to Non-Discrimination for exercising rights.</p>
                                    </div>
                                    <div className="p-6 bg-white/5 rounded-3xl space-y-4">
                                        <h4 className="font-black text-indigo-400 text-[10px] tracking-widest uppercase">HK/PDPO</h4>
                                        <p className="text-[11px] opacity-60">Right of access and correction under the Personal Data (Privacy) Ordinance of Hong Kong.</p>
                                    </div>
                                </div>
                                <p className="text-center text-[10px] font-mono opacity-40 uppercase tracking-widest pt-8">
                                    Exercise any right globally via the Support Portal.
                                </p>
                            </div>
                        </section>

                        {/* 4. Global EULA */}
                        <section id="eula" className="scroll-mt-24 space-y-12">
                            <div className="flex items-center gap-6">
                                <span className="text-5xl font-black text-white/5 italic select-none">04</span>
                                <h2 className="text-3xl font-black uppercase tracking-[0.3em] text-white">GLOBAL END-USER LICENSE AGREEMENT</h2>
                            </div>
                            
                            <div className="glass-panel p-10 md:p-16 rounded-[4rem] border border-white/10 bg-black/60 space-y-8 text-slate-400 text-sm leading-relaxed text-left">
                                <p>The site owner grants a limited, revocable, and non-exclusive license to utilize the GeoHunter interface. This license is subject to the strict prohibition of reverse-engineering, unauthorized API scraping, or binary deconstruction. Violation results in perpetual blacklisting from the Service.</p>
                                <p className="font-bold text-slate-200">The site owner retains 100% intellectual property ownership of the software, design, and neural prompts globally.</p>
                                <div className="p-6 border border-white/5 bg-black/40 rounded-3xl text-[11px] font-mono opacity-60 uppercase">
                                    WARRANTY DISCLAIMER: THE SOFTWARE IS PROVIDED "AS IS" IN ALL TERRITORIES WITHOUT EXCEPTION.
                                </div>
                            </div>
                        </section>

                    </div>
                </div>

                <div className="mt-40 pb-20 text-center">
                    <p className="text-[12px] font-black uppercase tracking-[0.8em] text-white/5 mb-4">
                        GEOHUNTER MASTER RECORD © 2026
                    </p>
                    <p className="text-[9px] font-mono text-white/10 tracking-widest uppercase">
                        Jurisdiction: Global Default // Sovereign Rights Reserved Under International Law.
                    </p>
                </div>
            </div>
        </div>
    );
}
