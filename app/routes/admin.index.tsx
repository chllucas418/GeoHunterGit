import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    return null;
}

export default function AdminDashboard() {
    return (
        <div className="min-h-screen relative z-10">
            {/* Header */}
            <header className="bg-[#0e1a14]/95 backdrop-blur-xl border-b border-brass/10">
                <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <div className="w-2 h-2 rounded-full bg-rust animate-pulse" />
                            <span className="text-[9px] font-mono text-rust uppercase tracking-[0.4em]">Developer Mode</span>
                        </div>
                        <h1 className="font-heading text-3xl font-black text-cream tracking-tight">Command Center</h1>
                        <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest mt-1">System Administration</p>
                    </div>
                    <Link to="/" className="px-4 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">
                        ← Base
                    </Link>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-10">
                {/* Quick Actions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Deploy Location - Primary */}
                    <Link to="/admin/mass-add" className="group p-8 bg-[#0a1210] border border-brass/30 hover:border-brass/50 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-brass/20 border border-brass/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">📍</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Deploy Targets</h3>
                        <p className="text-sm text-stone-light">Batch upload locations with AI analysis</p>
                        <div className="mt-4 text-[9px] font-mono text-brass uppercase tracking-widest">Bulk Import →</div>
                    </Link>

                    {/* Manage Locations */}
                    <Link to="/admin/locations" className="group p-8 bg-[#0a1210] border border-brass/10 hover:border-teal/30 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-teal/20 border border-teal/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">🗺️</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Locations</h3>
                        <p className="text-sm text-stone-light">Manage coordinates, quality, and settings</p>
                        <div className="mt-4 text-[9px] font-mono text-teal uppercase tracking-widest">Manage →</div>
                    </Link>

                    {/* Datasets */}
                    <Link to="/admin/datasets" className="group p-8 bg-[#0a1210] border border-brass/10 hover:border-amber/30 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-amber/20 border border-amber/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">📦</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Collections</h3>
                        <p className="text-sm text-stone-light">Organize locations into training sets</p>
                        <div className="mt-4 text-[9px] font-mono text-amber uppercase tracking-widest">Manage →</div>
                    </Link>

                    {/* Users */}
                    <Link to="/admin/users" className="group p-8 bg-[#0a1210] border border-brass/10 hover:border-purple-500/30 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">👥</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Agents</h3>
                        <p className="text-sm text-stone-light">Manage accounts, roles, and access</p>
                        <div className="mt-4 text-[9px] font-mono text-purple-400 uppercase tracking-widest">Manage →</div>
                    </Link>

                    {/* Create Teacher */}
                    <Link to="/admin/create-teacher" className="group p-8 bg-[#0a1210] border border-brass/10 hover:border-teal/30 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-teal/20 border border-teal/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">🎓</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Teachers</h3>
                        <p className="text-sm text-stone-light">Create teacher accounts for sessions</p>
                        <div className="mt-4 text-[9px] font-mono text-teal uppercase tracking-widest">Provision →</div>
                    </Link>

                    {/* Live Sessions */}
                    <Link to="/teacher/dashboard" className="group p-8 bg-[#0a1210] border border-brass/10 hover:border-teal/30 rounded-sm transition-all">
                        <div className="w-14 h-14 rounded-sm bg-teal/20 border border-teal/30 flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">🎮</div>
                        <h3 className="font-heading text-2xl font-black text-cream mb-2">Sessions</h3>
                        <p className="text-sm text-stone-light">Launch and control live simulations</p>
                        <div className="mt-4 text-[9px] font-mono text-teal uppercase tracking-widest">Control →</div>
                    </Link>
                </div>
            </div>
        </div>
    );
}