import { Link } from "react-router";

export default function Privacy() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8 flex items-center justify-center">
            <div className="max-w-2xl w-full bg-slate-900 p-12 rounded-3xl border border-slate-800 shadow-2xl space-y-8">
                <header>
                    <Link to="/" className="text-blue-400 hover:underline text-sm mb-4 inline-block">← Back to Discovery</Link>
                    <h1 className="text-3xl font-bold">Privacy Policy</h1>
                    <p className="text-slate-500 text-sm mt-1">Last updated: January 2026</p>
                </header>

                <section className="space-y-4 text-slate-300">
                    <p>GeoHunter is committed to your privacy. This policy explains what data we collect and how we use it.</p>

                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">1. Data Collection</h2>
                        <p>We collect your email and display name when you register to maintain your game scores and progress.</p>
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">2. Game Data</h2>
                        <p>We store your game guesses and AI feedback locally on Cloudflare D1 to show your performance and history.</p>
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">3. Security</h2>
                        <p>Passwords are hashed using industry-standard PBKDF2. We never store plain-text passwords.</p>
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">4. Contact</h2>
                        <p>For questions, contact the system administrator (Lucas Cheung).</p>
                    </div>
                </section>

                <footer className="pt-8 border-t border-slate-800">
                    <p className="text-slate-500 text-xs">© 2026 GeoHunter. All rights reserved.</p>
                </footer>
            </div>
        </div>
    );
}
