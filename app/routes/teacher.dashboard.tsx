import { Form, Link, useLoaderData, useNavigation, redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireTeacher, getUserId } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireTeacher(request);
    const userId = await getUserId(request) as string;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Fetch Map Sets
    const { results: mapSets } = await db.prepare(
        "SELECT * FROM map_sets ORDER BY created_at DESC"
    ).all<any>();

    // Fetch Active Rooms for this teacher
    const { results: activeRooms } = await db.prepare(
        "SELECT * FROM rooms WHERE host_id = ? AND status != 'PODIUM' ORDER BY created_at DESC"
    ).bind(userId).all<any>();

    return { mapSets, activeRooms, userId };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireTeacher(request);
    const userId = await getUserId(request) as string;
    const formData = await request.formData();
    const intent = formData.get("intent");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "create_default_set") {
        // Create a set containing ALL locations
        const setId = crypto.randomUUID();
        const setName = "Master Collection (All Locations)";

        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(setId, setName, "Auto-generated collection of all available locations.", userId).run();

        // Get all locations
        const { results: locations } = await db.prepare("SELECT id FROM locations").all<any>();

        // Insert items
        const stmt = db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)");
        const batch = locations.map((loc: any, index: number) => stmt.bind(setId, loc.id, index));
        await db.batch(batch);

        return { success: true, message: "Default Map Set created!" };
    }

    if (intent === "create_room") {
        const setId = formData.get("setId") as string;

        const timeLimit = parseInt(formData.get("timeLimit") as string) || 120;

        // Generate flexible 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        await db.prepare(
            "INSERT INTO rooms (code, host_id, map_set_id, status, time_limit) VALUES (?, ?, ?, 'WAITING', ?)"
        ).bind(code, userId, setId, timeLimit).run();

        return redirect(`/teacher/room/${code}`);
    }

    if (intent === "delete_room") {
        const code = formData.get("code") as string;
        await db.prepare("DELETE FROM room_participants WHERE room_code = ?").bind(code).run();
        await db.prepare("DELETE FROM room_guesses WHERE room_code = ?").bind(code).run();
        await db.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
        return { success: true };
    }

    return null;
}

export default function TeacherDashboard() {
    const { mapSets, activeRooms, userId } = useLoaderData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12 font-sans relative overflow-hidden">
            {/* Background Mesh (Low opacity) */}
            <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
                <div className="absolute top-[-20%] left-[-20%] w-[60vw] h-[60vw] bg-blue-900/40 rounded-full blur-[120px]" />
            </div>

            <div className="max-w-7xl mx-auto relative z-10">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-16">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-black uppercase tracking-widest border border-blue-500/30">
                                Instructor Clearance
                            </span>
                            <span className="text-xs font-mono text-slate-500">ID: {userId.slice(0, 8)}</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-2">
                            Mission Control
                        </h1>
                        <p className="text-slate-400 max-w-xl text-lg">
                            Manage classroom operations and deploy concurrent training simulations.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <Form method="post" action="/logout">
                            <button className="px-6 py-3 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-bold uppercase tracking-widest transition-all">
                                Terminate Session
                            </button>
                        </Form>
                    </div>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                    {/* LEFT COL: Active Rooms */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                Active Sessions
                            </h2>
                        </div>

                        {activeRooms.length === 0 ? (
                            <div className="p-8 rounded-3xl border border-dashed border-white/10 bg-white/5 text-center">
                                <p className="text-sm text-slate-500 font-bold mb-1">No Active Simulacrums</p>
                                <p className="text-xs text-slate-600">Launch a new session from the datasets.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {activeRooms.map((room: any) => (
                                    <div key={room.code} className="glass-panel p-6 rounded-2xl border border-white/10 relative group">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <div className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mb-1">Passcode</div>
                                                <div className="text-3xl font-black font-mono text-blue-400 tracking-widest">{room.code}</div>
                                            </div>
                                            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase rounded-full border border-emerald-500/20">
                                                {room.status}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Link
                                                to={`/teacher/room/${room.code}`}
                                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest text-center transition-all"
                                            >
                                                Reconnect Info-Link
                                            </Link>
                                            <Form method="post" className="contents">
                                                <input type="hidden" name="intent" value="delete_room" />
                                                <input type="hidden" name="code" value={room.code} />
                                                <button
                                                    onClick={(e) => !confirm("Shutdown this session?") && e.preventDefault()}
                                                    className="px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20 transition-all"
                                                >
                                                    ✕
                                                </button>
                                            </Form>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* RIGHT COL: Datasets */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-black uppercase tracking-widest text-slate-200">
                                Available Datasets
                            </h2>
                            {mapSets.length === 0 && (
                                <Form method="post">
                                    <input type="hidden" name="intent" value="create_default_set" />
                                    <button
                                        disabled={isSubmitting}
                                        className="text-xs font-bold text-blue-400 hover:text-white transition-colors uppercase tracking-wider"
                                    >
                                        + Generate Default Set
                                    </button>
                                </Form>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {mapSets.map((set: any) => (
                                <div key={set.id} className="glass-card p-8 rounded-[2rem] border border-white/5 bg-gradient-to-br from-white/5 to-transparent hover:from-white/10 transition-all group relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <svg className="w-12 h-12 text-white/5 transform rotate-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
                                    </div>

                                    <div className="relative z-10 mb-8">
                                        <h3 className="text-2xl font-black text-white mb-2 leading-tight group-hover:text-sky-300 transition-colors">{set.name}</h3>
                                        <p className="text-sm text-slate-400 leading-relaxed max-w-sm">{set.description}</p>
                                    </div>

                                    <div className="relative z-10 mt-auto">
                                        <Form method="post" className="space-y-4">
                                            <input type="hidden" name="intent" value="create_room" />
                                            <input type="hidden" name="setId" value={set.id} />

                                            {/* Customization Options */}
                                            <div className="bg-black/20 p-4 rounded-xl space-y-3">
                                                <div>
                                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Time Limit (Sec)</label>
                                                    <input
                                                        type="number"
                                                        name="timeLimit"
                                                        defaultValue={120}
                                                        min={30}
                                                        max={600}
                                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-white text-sm font-mono"
                                                    />
                                                </div>
                                                {/* Future: Location Filter UI (Too complex for this card, maybe just 'Limit Count') */}
                                            </div>

                                            <button
                                                disabled={isSubmitting}
                                                className="w-full py-4 bg-white text-black rounded-xl font-black uppercase tracking-widest hover:bg-sky-50 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 group-hover:shadow-sky-500/20"
                                            >
                                                <span>Deploy Simulation</span>
                                                <span className="text-lg">→</span>
                                            </button>
                                        </Form>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
