import { Link } from "react-router";

export default function PrivacyPolicy() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8 flex items-center justify-center">
            <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 p-12 rounded-[40px] shadow-2xl space-y-8">
                <header className="space-y-2">
                    <Link to="/" className="text-blue-400 hover:underline text-sm mb-4 inline-block">← Back to World</Link>
                    <h1 className="text-4xl font-black">Privacy Protocol</h1>
                </header>

                <section className="space-y-6 text-slate-400 leading-relaxed">
                    <div className="space-y-2">
                        <h2 className="font-bold text-slate-200">Data Collection</h2>
                        <p>GeoHunter only collects your email and an optional display name for the purpose of maintaining leaderboards and session persistence.</p>
                    </div>

                    <div className="space-y-2">
                        <h2 className="font-bold text-slate-200">Session Data</h2>
                        <p>Your game tactical data (guesses, coordinates, and AI scores) are stored securely and used only for game balancing and ranking.</p>
                    </div>

                    <div className="space-y-2">
                        <h2 className="font-bold text-slate-200">Identity Protection</h2>
                        <p>We do not share your email with third parties. Your display name is the only identifier visible to other agents.</p>
                    </div>
                </section>

                <footer className="pt-8 border-t border-slate-800">
                    <p className="text-xs text-slate-600 font-mono">Effective: 2026.01.31 // Revision 1.0</p>
                </footer>
            </div>
        </div>
    );
}
