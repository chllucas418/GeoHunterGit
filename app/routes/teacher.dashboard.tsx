import { useState } from "react";
import { Form, Link, useLoaderData, useNavigation, redirect, useSearchParams, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireTeacher, getUserId } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireTeacher(request);
    const userId = await getUserId(request) as string;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const search = url.searchParams.get("search") || "";
    const limit = 6; // Compact grid for the integrated view
    const offset = (page - 1) * limit;

    // Fetch Map Sets with item counts
    const { results: mapSets } = await db.prepare(
        `SELECT ms.*, COUNT(msi.location_id) as item_count 
         FROM map_sets ms 
         LEFT JOIN map_set_items msi ON ms.id = msi.set_id 
         GROUP BY ms.id 
         ORDER BY ms.created_at DESC`
    ).all<any>();

    // Fetch Active Rooms for this teacher with map set names
    const { results: activeRooms } = await db.prepare(
        `SELECT r.*, ms.name as map_set_name 
         FROM rooms r 
         LEFT JOIN map_sets ms ON r.map_set_id = ms.id 
         WHERE r.host_id = ? AND r.status != 'PODIUM' 
         ORDER BY r.created_at DESC`
    ).bind(userId).all<any>();

    // Fetch locations with optional search filtering
    let locationsQuery = "SELECT id, lat, lng, difficulty_rating, quality_score, created_at, is_default_simulation FROM locations";
    let countQuery = "SELECT COUNT(*) as count FROM locations";
    let countResult;
    let locations;

    if (search) {
        locationsQuery += " WHERE id LIKE ? OR lat LIKE ? OR lng LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?";
        const binding = `%${search}%`;
        const queryRes = await db.prepare(locationsQuery).bind(binding, binding, binding, limit, offset).all<any>();
        locations = queryRes.results;
        countResult = await db.prepare(countQuery + " WHERE id LIKE ? OR lat LIKE ? OR lng LIKE ?").bind(binding, binding, binding).first<any>();
    } else {
        locationsQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        const queryRes = await db.prepare(locationsQuery).bind(limit, offset).all<any>();
        locations = queryRes.results;
        countResult = await db.prepare(countQuery).first<any>();
    }

    const totalLocations = countResult ? countResult.count : 0;
    const totalPages = Math.ceil(totalLocations / limit);

    return { mapSets, activeRooms, locations, page, totalPages, search, userId };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireTeacher(request);
    const userId = await getUserId(request) as string;
    const formData = await request.formData();
    const intent = formData.get("intent");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "create_default_set") {
        const setId = crypto.randomUUID();
        const setName = "Master Collection (All Locations)";
        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(setId, setName, "Auto-generated collection of all available locations.", userId).run();

        const { results: locations } = await db.prepare("SELECT id FROM locations").all<any>();
        const stmt = db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)");
        const batch = locations.map((loc: any, index: number) => stmt.bind(setId, loc.id, index));
        if (batch.length > 0) {
            await db.batch(batch);
        }
        return { success: true, message: "Default Map Set created!" };
    }

    if (intent === "create_set") {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const id = crypto.randomUUID();

        if (!name) return { error: "Name is required" };

        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(id, name, description, userId).run();

        return { success: true, message: "Map set created!" };
    }

    if (intent === "delete_set") {
        const id = formData.get("id") as string;
        await db.prepare("DELETE FROM map_set_items WHERE set_id = ?").bind(id).run();
        await db.prepare("DELETE FROM map_sets WHERE id = ?").bind(id).run();
        return { success: true, message: "Map set deleted!" };
    }

    if (intent === "create_room") {
        const setId = formData.get("setId") as string;
        const timeLimit = parseInt(formData.get("timeLimit") as string) || 120;
        const hintInterval = parseInt(formData.get("hintInterval") as string) || 30;
        const hasGuidedPlaythrough = formData.get("hasGuidedPlaythrough") ? 1 : 0;
        const curriculumFocus = formData.get("curriculumFocus") as string || "None";

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        await db.prepare(
            "INSERT INTO rooms (code, host_id, map_set_id, status, time_limit, hint_interval, has_guided_playthrough, curriculum_focus) VALUES (?, ?, ?, 'WAITING', ?, ?, ?, ?)"
        ).bind(code, userId, setId, timeLimit, hintInterval, hasGuidedPlaythrough, curriculumFocus).run();

        return redirect(`/teacher/room/${code}`);
    }

    if (intent === "delete_room") {
        const code = formData.get("code") as string;
        await db.prepare("DELETE FROM room_participants WHERE room_code = ?").bind(code).run();
        await db.prepare("DELETE FROM room_guesses WHERE room_code = ?").bind(code).run();
        await db.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
        return { success: true };
    }

    if (intent === "delete_location") {
        const locId = formData.get("locId") as string;
        await db.prepare("DELETE FROM map_evidence WHERE location_id = ?").bind(locId).run();
        await db.prepare("DELETE FROM room_guesses WHERE location_id = ?").bind(locId).run();
        await db.prepare("DELETE FROM map_set_items WHERE location_id = ?").bind(locId).run();
        await db.prepare("DELETE FROM game_sessions WHERE location_id = ?").bind(locId).run();
        await db.prepare("DELETE FROM locations WHERE id = ?").bind(locId).run();
        return { success: true };
    }

    if (intent === "edit_location") {
        const locId = formData.get("locId") as string;
        const lat = parseFloat(formData.get("lat") as string);
        const lng = parseFloat(formData.get("lng") as string);
        const diff = parseFloat(formData.get("diff") as string);
        const quality = parseInt(formData.get("quality") as string);

        await db.prepare("UPDATE locations SET lat = ?, lng = ?, difficulty_rating = ?, quality_score = ? WHERE id = ?")
            .bind(lat, lng, diff, quality, locId).run();
        return { success: true };
    }

    if (intent === "setDefaultSim") {
        const locId = formData.get("locId") as string;
        await db.prepare("UPDATE locations SET is_default_simulation = 0").run();
        await db.prepare("UPDATE locations SET is_default_simulation = 1 WHERE id = ?").bind(locId).run();
        return { success: true };
    }

    return null;
}

export default function TeacherDashboard() {
    const { mapSets, activeRooms, locations, page, totalPages, search, userId } = useLoaderData() as any;
    const navigation = useNavigation();
    const [searchParams, setSearchParams] = useSearchParams();
    const fetcher = useFetcher();

    const activeTab = searchParams.get("tab") || "simulation";
    const isSubmitting = navigation.state === "submitting";

    // Track which locations have their inline editor active
    const [editingLocId, setEditingLocId] = useState<string | null>(null);

    // Track form inputs for the active editing location
    const [editLat, setEditLat] = useState("");
    const [editLng, setEditLng] = useState("");
    const [editDiff, setEditDiff] = useState("");
    const [editQuality, setEditQuality] = useState("");

    const switchTab = (tab: string) => {
        setSearchParams((prev) => {
            prev.set("tab", tab);
            return prev;
        });
    };

    const startEditing = (loc: any) => {
        setEditingLocId(loc.id);
        setEditLat(loc.lat.toString());
        setEditLng(loc.lng.toString());
        setEditDiff(loc.difficulty_rating.toString());
        setEditQuality(loc.quality_score.toString());
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12 font-sans relative overflow-hidden">
            {/* Ambient Lighting Gradients */}
            <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
                <div className="absolute top-[-10%] right-[-10%] w-[60vw] h-[60vw] bg-indigo-900/30 rounded-full blur-[140px]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-blue-950/40 rounded-full blur-[120px]" />
            </div>

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Dashboard Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-black uppercase tracking-widest border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
                                Instructor Space
                            </span>
                            <span className="text-xs font-mono text-slate-500">System ID: {userId.slice(0, 8)}</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-2 text-glow">
                            Mission Control
                        </h1>
                        <p className="text-slate-400 max-w-xl text-md md:text-lg">
                            Simplify classroom operations, manage geo-intelligence assets, and deploy training simulations.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <Form method="post" action="/logout">
                            <button className="px-6 py-3.5 rounded-xl border border-white/10 hover:border-red-500/30 hover:bg-red-500/10 text-xs font-bold uppercase tracking-widest transition-all duration-300">
                                Terminate Session
                            </button>
                        </Form>
                    </div>
                </header>

                {/* Glassmorphic Navigation Tabs */}
                <div className="glass-panel p-2 rounded-2xl flex flex-wrap gap-2 mb-10 border border-white/5 bg-slate-900/40 backdrop-blur-md relative">
                    <button
                        onClick={() => switchTab("simulation")}
                        className={`flex-1 min-w-[150px] py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 ${
                            activeTab === "simulation"
                                ? "bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                                : "text-slate-400 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <span>📡</span>
                        <span>Simulation Control</span>
                    </button>
                    <button
                        onClick={() => switchTab("datasets")}
                        className={`flex-1 min-w-[150px] py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 ${
                            activeTab === "datasets"
                                ? "bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                                : "text-slate-400 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <span>📦</span>
                        <span>Datasets Registry</span>
                    </button>
                    <button
                        onClick={() => switchTab("locations")}
                        className={`flex-1 min-w-[150px] py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 ${
                            activeTab === "locations"
                                ? "bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                                : "text-slate-400 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <span>📍</span>
                        <span>Geolocation Logistics</span>
                    </button>
                </div>

                {/* Dashboard Tabs Content */}
                <main className="min-h-[400px]">
                    {/* TAB 1: SIMULATION CONTROL */}
                    {activeTab === "simulation" && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                            {/* Active Rooms */}
                            <div className="lg:col-span-1 space-y-6">
                                <h2 className="text-lg font-black uppercase tracking-widest text-slate-300 flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                                    Active Classroom Sessions
                                </h2>

                                {activeRooms.length === 0 ? (
                                    <div className="p-8 rounded-3xl border border-dashed border-white/10 bg-white/5 text-center flex flex-col items-center justify-center h-64">
                                        <p className="text-sm text-slate-400 font-bold mb-2">No Active Simulacrums</p>
                                        <p className="text-xs text-slate-500 max-w-xs">
                                            Create and launch a classroom room using one of the available datasets.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {activeRooms.map((room: any) => (
                                            <div
                                                key={room.code}
                                                className="glass-panel p-6 rounded-2xl border border-white/10 relative group bg-gradient-to-b from-white/5 to-transparent hover:border-blue-500/20 transition-all duration-300"
                                            >
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <div className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mb-1">
                                                            Classroom Code
                                                        </div>
                                                        <div className="text-3xl font-black font-mono text-blue-400 tracking-widest">
                                                            {room.code}
                                                        </div>
                                                    </div>
                                                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase rounded-full border border-emerald-500/20">
                                                        {room.status}
                                                    </span>
                                                </div>

                                                <div className="space-y-2 mb-6">
                                                    <div className="text-xs text-slate-400">
                                                        <strong className="text-slate-300">Dataset:</strong>{" "}
                                                        {room.map_set_name || "Unknown"}
                                                    </div>
                                                    <div className="text-xs text-slate-400">
                                                        <strong className="text-slate-300">Time Limit:</strong>{" "}
                                                        {room.time_limit}s | <strong className="text-slate-300">Hints:</strong> every {room.hint_interval}s
                                                    </div>
                                                    {room.curriculum_focus !== "None" && (
                                                        <div className="text-xs text-slate-400">
                                                            <strong className="text-slate-300">Curriculum:</strong>{" "}
                                                            <span className="text-indigo-400">{room.curriculum_focus}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex gap-2">
                                                    <Link
                                                        to={`/teacher/room/${room.code}`}
                                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest text-center transition-all duration-300 hover:shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                                                    >
                                                        Reconnect Control
                                                    </Link>
                                                    <fetcher.Form method="post" className="contents">
                                                        <input type="hidden" name="intent" value="delete_room" />
                                                        <input type="hidden" name="code" value={room.code} />
                                                        <button
                                                            onClick={(e) =>
                                                                !confirm("Terminate classroom room?") && e.preventDefault()
                                                            }
                                                            className="px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20 transition-all duration-300"
                                                            title="Terminate Room"
                                                        >
                                                            ✕
                                                        </button>
                                                    </fetcher.Form>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Deploy Section */}
                            <div className="lg:col-span-2 space-y-6">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-black uppercase tracking-widest text-slate-300">
                                        Deploy New Training Simulation
                                    </h2>
                                    {mapSets.length === 0 && (
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="create_default_set" />
                                            <button
                                                disabled={isSubmitting}
                                                className="text-xs font-bold text-blue-400 hover:text-white transition-colors uppercase tracking-wider"
                                            >
                                                + Generate Master Set
                                            </button>
                                        </fetcher.Form>
                                    )}
                                </div>

                                {mapSets.length === 0 ? (
                                    <div className="p-8 rounded-3xl border border-dashed border-white/10 bg-white/5 text-center flex flex-col items-center justify-center h-64">
                                        <p className="text-sm text-slate-400 font-bold mb-2">No Datasets Found</p>
                                        <p className="text-xs text-slate-500 mb-4 max-w-sm">
                                            Generate the master collection of all locations or go to the Datasets Registry tab to build one.
                                        </p>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="create_default_set" />
                                            <button
                                                type="submit"
                                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-300"
                                            >
                                                Auto-Generate Master Dataset
                                            </button>
                                        </fetcher.Form>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {mapSets.map((set: any) => (
                                            <div
                                                key={set.id}
                                                className="glass-card p-6 rounded-[2rem] border border-white/5 bg-gradient-to-br from-white/5 to-transparent hover:from-white/10 hover:border-white/10 transition-all duration-500 group flex flex-col justify-between"
                                            >
                                                <div>
                                                    <div className="flex justify-between items-start mb-4">
                                                        <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[9px] font-mono border border-white/5">
                                                            {set.item_count} location{set.item_count === 1 ? "" : "s"}
                                                        </span>
                                                    </div>
                                                    <h3 className="text-xl font-black text-white mb-2 leading-tight group-hover:text-blue-400 transition-colors">
                                                        {set.name}
                                                    </h3>
                                                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 mb-6">
                                                        {set.description || "No description provided."}
                                                    </p>
                                                </div>

                                                <Form method="post" className="space-y-4">
                                                    <input type="hidden" name="intent" value="create_room" />
                                                    <input type="hidden" name="setId" value={set.id} />

                                                    {/* Config Drawer */}
                                                    <div className="bg-slate-950/80 border border-white/5 rounded-2xl p-4 space-y-3">
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">
                                                                    Timer (Sec)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    name="timeLimit"
                                                                    defaultValue={120}
                                                                    min={30}
                                                                    max={600}
                                                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">
                                                                    Hints (Sec)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    name="hintInterval"
                                                                    defaultValue={30}
                                                                    min={10}
                                                                    max={120}
                                                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">
                                                                Curriculum Focus
                                                            </label>
                                                            <select
                                                                name="curriculumFocus"
                                                                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs font-bold focus:border-blue-500 focus:outline-none"
                                                            >
                                                                <option value="None">None (Default Rules)</option>
                                                                <option value="Architecture & Estates">Architecture & Estates</option>
                                                                <option value="Transport & LRT">Transport & LRT</option>
                                                                <option value="History & Culture">History & Culture</option>
                                                                <option value="Environment & Nature">Environment & Nature</option>
                                                            </select>
                                                        </div>

                                                        <div className="pt-1">
                                                            <label className="flex items-center gap-2 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    name="hasGuidedPlaythrough"
                                                                    className="form-checkbox text-blue-500 rounded bg-slate-900 border-white/10 cursor-pointer"
                                                                    defaultChecked
                                                                />
                                                                <span className="text-[9px] uppercase font-bold text-emerald-400">
                                                                    Include Guided Practice
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </div>

                                                    <button
                                                        type="submit"
                                                        disabled={isSubmitting}
                                                        className="w-full py-3.5 bg-white text-black rounded-xl font-black uppercase tracking-widest hover:bg-blue-50 hover:text-blue-600 transition-all duration-300 shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                                                    >
                                                        <span>Deploy Simulation</span>
                                                        <span className="text-sm">→</span>
                                                    </button>
                                                </Form>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 2: DATASETS REGISTRY */}
                    {activeTab === "datasets" && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                            {/* Create Dataset Form */}
                            <div className="lg:col-span-1 space-y-6">
                                <h2 className="text-lg font-black uppercase tracking-widest text-slate-300">
                                    Create Custom Dataset
                                </h2>
                                <Form method="post" className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4">
                                    <input type="hidden" name="intent" value="create_set" />
                                    <div>
                                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1.5">
                                            Dataset Name
                                        </label>
                                        <input
                                            type="text"
                                            name="name"
                                            required
                                            placeholder="e.g. Tuen Mun Architecture"
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-600 font-bold"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase font-bold text-slate-400 mb-1.5">
                                            Detailed Description
                                        </label>
                                        <textarea
                                            name="description"
                                            rows={4}
                                            placeholder="Provide notes on the learning intent, difficulty level, or regional mapping target."
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-600 leading-relaxed"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 hover:shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                                    >
                                        Establish Dataset Registry
                                    </button>
                                </Form>
                            </div>

                            {/* Dataset Grid List */}
                            <div className="lg:col-span-2 space-y-6">
                                <h2 className="text-lg font-black uppercase tracking-widest text-slate-300">
                                    Active Collections
                                </h2>
                                {mapSets.length === 0 ? (
                                    <div className="p-8 rounded-3xl border border-dashed border-white/10 bg-white/5 text-center flex flex-col items-center justify-center h-64">
                                        <p className="text-sm text-slate-400 font-bold">No Collections Established</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {mapSets.map((set: any) => (
                                            <div
                                                key={set.id}
                                                className="glass-card p-6 rounded-[2rem] border border-white/5 bg-gradient-to-br from-white/5 to-transparent hover:border-white/10 flex flex-col justify-between group transition-all duration-300"
                                            >
                                                <div>
                                                    <div className="flex justify-between items-center mb-4">
                                                        <span className="px-3 py-1 bg-blue-500/10 text-blue-300 text-[10px] font-bold uppercase rounded-full border border-blue-500/20">
                                                            {set.item_count} locations
                                                        </span>
                                                        <span className="text-[10px] font-mono text-slate-500">
                                                            ID: {set.id.slice(0, 8)}
                                                        </span>
                                                    </div>
                                                    <h3 className="text-2xl font-black text-white mb-2 leading-tight group-hover:text-blue-400 transition-colors">
                                                        {set.name}
                                                    </h3>
                                                    <p className="text-xs text-slate-400 leading-relaxed mb-6">
                                                        {set.description || "No description provided."}
                                                    </p>
                                                </div>

                                                <div className="flex gap-2 mt-auto">
                                                    <Link
                                                        to={`/admin/datasets/${set.id}`}
                                                        className="flex-1 py-3 bg-white/10 hover:bg-white/20 border border-white/5 hover:border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-center text-white transition-all duration-300"
                                                    >
                                                        Edit Details & Items
                                                    </Link>
                                                    <fetcher.Form method="post" className="contents">
                                                        <input type="hidden" name="intent" value="delete_set" />
                                                        <input type="hidden" name="id" value={set.id} />
                                                        <button
                                                            onClick={(e) =>
                                                                !confirm("Decommission this collection? All locations mapped to this set will be unlinked.") && e.preventDefault()
                                                            }
                                                            className="px-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-all duration-300"
                                                            title="Delete Dataset"
                                                        >
                                                            ✕
                                                        </button>
                                                    </fetcher.Form>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: GEOLOCATION LOGISTICS */}
                    {activeTab === "locations" && (
                        <div className="space-y-8 animate-slide-in">
                            {/* Toolbar Panel */}
                            <div className="glass-panel p-6 rounded-3xl border border-white/10 bg-slate-900/60 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                {/* Search Form */}
                                <Form method="get" className="flex items-center gap-2 flex-grow max-w-lg">
                                    <input type="hidden" name="tab" value="locations" />
                                    <input
                                        type="text"
                                        name="search"
                                        defaultValue={search}
                                        placeholder="Search by ID, Lat, or Lng..."
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:outline-none placeholder-slate-600"
                                    />
                                    <button
                                        type="submit"
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300"
                                    >
                                        Search
                                    </button>
                                    {search && (
                                        <Link
                                            to="?tab=locations"
                                            className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold uppercase transition-all duration-300"
                                        >
                                            Clear
                                        </Link>
                                    )}
                                </Form>

                                {/* Export & Import Commands */}
                                <div className="flex flex-wrap items-center gap-3">
                                    <a
                                        href="/api/admin/export-locations"
                                        download
                                        className="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300"
                                    >
                                        ⬇ Export CSV
                                    </a>
                                    <a
                                        href="/api/admin/export-sessions"
                                        download
                                        className="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300"
                                    >
                                        ⬇ Session CSV
                                    </a>
                                    <Link
                                        to="/admin/mass-add"
                                        className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300 shadow-md shadow-indigo-600/20"
                                    >
                                        📂 Bulk Import
                                    </Link>
                                    <Link
                                        to="/admin/add-location"
                                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all duration-300 hover:scale-105 shadow-md shadow-emerald-600/20"
                                    >
                                        + Manual Deploy
                                    </Link>
                                </div>
                            </div>

                            {/* Locations Listing */}
                            {locations.length === 0 ? (
                                <div className="p-12 rounded-[2.5rem] border border-dashed border-white/10 bg-white/5 text-center flex flex-col items-center justify-center">
                                    <p className="text-sm text-slate-400 font-bold mb-1">No Location Assets Deployed</p>
                                    <p className="text-xs text-slate-500 max-w-sm">
                                        Begin mapping regional structures by deploying a location manual asset or performing bulk uploads.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                    {locations.map((loc: any) => {
                                        const isEditingThis = editingLocId === loc.id;
                                        return (
                                            <div
                                                key={loc.id}
                                                className="glass-card rounded-[2rem] overflow-hidden flex flex-col group relative border border-white/5 hover:border-blue-500/20 bg-gradient-to-b from-white/5 to-transparent hover:to-white/10 transition-all duration-500"
                                            >
                                                {/* Card Image */}
                                                <div className="h-44 relative overflow-hidden">
                                                    <img
                                                        src={`/resources/image/${loc.id}`}
                                                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                                        alt="Map Coordinate preview"
                                                        loading="lazy"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                                                    <div className="absolute bottom-3 left-4 font-mono text-[10px] text-slate-400">
                                                        ID: {loc.id.slice(0, 8)}...
                                                    </div>
                                                    <div className="absolute top-3 right-4 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider backdrop-blur-md border border-white/10 bg-slate-950/60 text-indigo-300">
                                                        Diff: {loc.difficulty_rating.toFixed(2)}
                                                    </div>
                                                </div>

                                                {/* Content Panel */}
                                                <div className="p-5 flex-grow flex flex-col justify-between space-y-4">
                                                    {isEditingThis ? (
                                                        <fetcher.Form
                                                            method="post"
                                                            onSubmit={() => setEditingLocId(null)}
                                                            className="space-y-3"
                                                        >
                                                            <input type="hidden" name="intent" value="edit_location" />
                                                            <input type="hidden" name="locId" value={loc.id} />
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="block text-[8px] uppercase font-bold text-slate-400 mb-1">
                                                                        Latitude
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        name="lat"
                                                                        value={editLat}
                                                                        onChange={(e) => setEditLat(e.target.value)}
                                                                        className="w-full bg-slate-950 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[8px] uppercase font-bold text-slate-400 mb-1">
                                                                        Longitude
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        name="lng"
                                                                        value={editLng}
                                                                        onChange={(e) => setEditLng(e.target.value)}
                                                                        className="w-full bg-slate-950 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="block text-[8px] uppercase font-bold text-slate-400 mb-1">
                                                                        Difficulty
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        name="diff"
                                                                        step="0.01"
                                                                        min="1"
                                                                        max="10"
                                                                        value={editDiff}
                                                                        onChange={(e) => setEditDiff(e.target.value)}
                                                                        className="w-full bg-slate-950 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[8px] uppercase font-bold text-slate-400 mb-1">
                                                                        Signal Quality
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        name="quality"
                                                                        min="0"
                                                                        max="100"
                                                                        value={editQuality}
                                                                        onChange={(e) => setEditQuality(e.target.value)}
                                                                        className="w-full bg-slate-950 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-1.5 pt-2">
                                                                <button
                                                                    type="submit"
                                                                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-[10px] font-bold uppercase text-white transition-colors border border-emerald-500/20"
                                                                >
                                                                    Save Changes
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditingLocId(null)}
                                                                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold uppercase text-slate-300 transition-colors border border-white/5"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </fetcher.Form>
                                                    ) : (
                                                        <>
                                                            {/* Coords & Metrics grid */}
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5">
                                                                    <p className="text-[8px] uppercase font-bold text-slate-500 mb-0.5">
                                                                        Quality Score
                                                                    </p>
                                                                    <p className="text-lg font-black text-slate-100">
                                                                        {loc.quality_score}%
                                                                    </p>
                                                                </div>
                                                                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5">
                                                                    <p className="text-[8px] uppercase font-bold text-slate-500 mb-0.5">
                                                                        Coordinates
                                                                    </p>
                                                                    <p
                                                                        className="text-[10px] font-mono text-slate-300 truncate"
                                                                        title={`${loc.lat}, ${loc.lng}`}
                                                                    >
                                                                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            {/* Modification operations */}
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => startEditing(loc)}
                                                                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider text-center text-white transition-colors"
                                                                >
                                                                    Modify
                                                                </button>
                                                                <fetcher.Form method="post" className="contents">
                                                                    <input
                                                                        type="hidden"
                                                                        name="intent"
                                                                        value="delete_location"
                                                                    />
                                                                    <input type="hidden" name="locId" value={loc.id} />
                                                                    <button
                                                                        onClick={(e) =>
                                                                            !confirm(
                                                                                "WARNING: Decommission this geolocation asset permanently?"
                                                                            ) && e.preventDefault()
                                                                        }
                                                                        className="px-3 py-2.5 bg-red-500/10 hover:bg-red-500/25 border border-red-500/10 hover:border-red-500/20 text-red-400 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                                                                    >
                                                                        Purge
                                                                    </button>
                                                                </fetcher.Form>
                                                            </div>

                                                            {/* Default Simulation Toggler */}
                                                            <button
                                                                onClick={() => {
                                                                    const fd = new FormData();
                                                                    fd.append("intent", "setDefaultSim");
                                                                    fd.append("locId", loc.id);
                                                                    fetcher.submit(fd, { method: "post" });
                                                                }}
                                                                className={`w-full py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                                                                    loc.is_default_simulation
                                                                        ? "bg-blue-600/90 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                                                                        : "bg-white/5 border-white/5 hover:bg-white/10 text-slate-300 hover:text-white"
                                                                }`}
                                                            >
                                                                {loc.is_default_simulation
                                                                    ? "★ Default Simulation Active"
                                                                    : "Set as Default Sim"}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="flex justify-center items-center gap-4 pt-6">
                                    <Link
                                        to={`?tab=locations&page=${Math.max(1, page - 1)}&search=${search}`}
                                        className={`px-4 py-2.5 bg-slate-900 border border-white/10 rounded-xl text-xs font-bold hover:bg-slate-800 transition ${
                                            page === 1 ? "opacity-40 pointer-events-none" : ""
                                        }`}
                                    >
                                        Previous
                                    </Link>
                                    <span className="text-xs font-mono text-slate-500">
                                        Page {page} of {totalPages}
                                    </span>
                                    <Link
                                        to={`?tab=locations&page=${Math.min(totalPages, page + 1)}&search=${search}`}
                                        className={`px-4 py-2.5 bg-slate-900 border border-white/10 rounded-xl text-xs font-bold hover:bg-slate-800 transition ${
                                            page >= totalPages ? "opacity-40 pointer-events-none" : ""
                                        }`}
                                    >
                                        Next
                                    </Link>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
