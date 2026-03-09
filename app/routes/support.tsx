import { Link } from "react-router";

export default function Support() {
    return (
        <div className="min-h-screen bg-[#0c0f17] text-slate-100 p-6 md:p-12 lg:p-24 relative overflow-hidden flex items-center justify-center">
            {/* Background Decor */}
            <div className="absolute top-[-10%] left-[-10%] w-[800px] h-[800px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[800px] h-[800px] bg-indigo-600/5 rounded-full blur-[150px] pointer-events-none" />

            <div className="max-w-2xl w-full relative z-10 glass-panel p-12 md:p-20 rounded-[4rem] border border-white/10 bg-black/40 text-center space-y-12">
                <div className="flex justify-center mb-8">
                    <Link to="/" className="px-6 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-[0.4em] text-white/60 transition-all">
                        ← RETURN TO SYSTEM INTERFACE
                    </Link>
                </div>
                <header className="space-y-4">
                    <div className="w-20 h-20 bg-blue-500/10 rounded-3xl border border-blue-500/20 flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(59,130,246,0.1)]">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-blue-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                        </svg>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white">Technical Support</h1>
                    <p className="text-slate-400 text-sm tracking-wide uppercase font-black opacity-40">Direct Operative Assistance</p>
                </header>

                <div className="space-y-6">
                    <p className="text-slate-300 leading-relaxed text-sm">
                        For protocol inquiries, account recovery, or system vulnerability reporting, please contact the site administrator directly via encrypted channel.
                    </p>
                    
                    <div className="py-8 px-4 bg-white/5 rounded-3xl border border-white/5 group hover:border-blue-500/30 transition-all duration-500">
                        <p className="text-[10px] uppercase tracking-[0.4em] text-white/20 mb-3">Primary Contact Portal</p>
                        <a href="mailto:chllucas@chllucas.com" className="text-xl md:text-2xl font-mono text-blue-300 group-hover:text-white transition-colors">
                            chllucas@chllucas.com
                        </a>
                    </div>
                </div>

                <footer className="pt-8">
                    <Link to="/" className="inline-block px-10 py-4 rounded-full bg-white text-black text-[10px] font-black uppercase tracking-[0.3em] hover:bg-blue-50 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all transform hover:-translate-y-1">
                        Return to System
                    </Link>
                </footer>
            </div>
        </div>
    );
}
