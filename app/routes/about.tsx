import { Link } from "react-router";

export default function About() {
    return (
        <div className="min-h-screen bg-[#0c0f17] text-slate-100 p-8 md:p-16 relative">
            <div className="max-w-3xl mx-auto space-y-12">
                <header className="border-b border-white/10 pb-8">
                    <Link to="/" className="text-sm text-blue-400 hover:text-blue-300 mb-8 inline-block">
                        &larr; Back to App
                    </Link>
                    <h1 className="text-4xl font-bold mt-4">About GeoHunter & Data Usage</h1>
                </header>

                <section className="space-y-6">
                    <h2 className="text-2xl font-semibold text-white">App Purpose</h2>
                    <p className="text-slate-300 leading-relaxed">
                        GeoHunter is a geographic puzzle and educational platform where players identify locations from images and map clues. It is designed to engage students and players in analyzing visual evidence and geographical context to pinpoint specific real-world locations. The application features leaderboards, team-based gameplay, and teacher dashboards to facilitate educational scavenger hunts and location-based challenges.
                    </p>
                </section>

                <section className="space-y-6">
                    <h2 className="text-2xl font-semibold text-white">How We Use Google User Data</h2>
                    <p className="text-slate-300 leading-relaxed">
                        GeoHunter requests access to specific Google User Data to provide a seamless and integrated educational experience. The data requested is strictly utilized for the following core functionalities:
                    </p>
                    
                    <ul className="list-disc list-inside space-y-4 text-slate-300 ml-4">
                        <li>
                            <strong className="text-white">Authentication & Profiles:</strong> We use your basic Google profile information (such as your email address) to authenticate your account, maintain secure access, and track your gameplay progress and leaderboard standings.
                        </li>
                        <li>
                            <strong className="text-white">Educational Data Ingestion:</strong> For teachers and students, the app may request read-only access to specific Google Classroom or Google Drive files (such as student presentations or assignment attachments). This is used <em>solely</em> to automatically extract location evidence and images submitted by students, streamlining the process of importing verified game locations into the platform.
                        </li>
                    </ul>

                    <p className="text-slate-300 leading-relaxed mt-4">
                        <strong>Important:</strong> GeoHunter does not sell, trade, or otherwise transfer your Google User Data to outside parties. All extracted data is processed securely and is strictly confined to facilitating the gameplay and educational verification features within the application itself.
                    </p>
                </section>
                
                <footer className="flex flex-col md:flex-row justify-between items-center pt-8 text-sm text-slate-500 border-t border-white/10 mt-12">
                    <p>&copy; {new Date().getFullYear()} GeoHunter. All rights reserved.</p>
                    <a href="https://hkgeohunter.com/privacy" className="text-blue-400 hover:text-blue-300 mt-4 md:mt-0 transition-colors">
                        Privacy Policy
                    </a>
                </footer>
            </div>
        </div>
    );
}
