import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    return null;
}

export default function AdminDashboard() {
    return (
        <div className="min-h-screen p-6 md:p-12 relative z-10 bg-slate-950">
            <div className="max-w-7xl mx-auto">
                <header className="mb-12">
                    <Link to="/" className="text-blue-300 hover:text-white text-xs uppercase tracking-widest font-bold mb-4 inline-block transition-colors">
                        ← Return to Base
                    </Link>
                    <h1 className="text-5xl font-black text-white tracking-tighter text-glow">
                        Command Center
                    </h1>
                    <p className="text-blue-200/60 font-mono mt-2">Administrative controls and system diagnostics.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Location Management */}
                    <Link to="/admin/locations" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-emerald-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            M
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Locations</h3>
                            <p className="text-sm text-white/50">Manage geographic data points, edit coordinates, and verify AI assets.</p>
                        </div>
                    </Link>

                    {/* User Management */}
                    <Link to="/admin/users" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-purple-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            A
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Agents</h3>
                            <p className="text-sm text-white/50">Manage user accounts, roles, and revoke clearances.</p>
                        </div>
                    </Link>

                    {/* Dataset Management */}
                    <Link to="/admin/datasets" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-pink-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-pink-500/20 text-pink-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            D
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Datasets</h3>
                            <p className="text-sm text-white/50">Organize loose locations into categorized map sets.</p>
                        </div>
                    </Link>

                    {/* Create Teacher */}
                    <Link to="/admin/create-teacher" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-yellow-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-yellow-500/20 text-yellow-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            T
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Provision Teacher</h3>
                            <p className="text-sm text-white/50">Create restricted access accounts for classroom sessions.</p>
                        </div>
                    </Link>

                    {/* Teacher Dashboard Access */}
                    <Link to="/teacher/dashboard" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-blue-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            S
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Live Sessions</h3>
                            <p className="text-sm text-white/50">Mission Control: Initiate rooms, control simulations, and monitor participants.</p>
                        </div>
                    </Link>

                    {/* Add New Location */}
                    <Link to="/admin/add-location" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-emerald-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            +
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Add Location</h3>
                            <p className="text-sm text-white/50">Add a single location manually to the database.</p>
                        </div>
                    </Link>

                    <Link to="/admin/mass-add" className="glass-card p-8 rounded-3xl hover:bg-white/5 transition-all group flex flex-col h-64 justify-between border border-white/5 hover:border-blue-500/30">
                        <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-300 flex items-center justify-center text-2xl font-black mb-4 group-hover:scale-110 transition-transform">
                            U
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-white mb-2">Mass Upload</h3>
                            <p className="text-sm text-white/50">Batch import locations using drag-and-drop.</p>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}
