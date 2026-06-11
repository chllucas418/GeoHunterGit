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
    const limit = 9;
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

    // Fetch stats
    const statsPromise = db.prepare(`
        SELECT
            COUNT(*) as totalLocations,
            AVG(quality_score) as avgQuality,
            SUM(CASE WHEN is_default_simulation = 1 THEN 1 ELSE 0 END) as defaultSims
        FROM locations
    `).first<any>();

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

    return { mapSets, activeRooms, locations, page, totalPages, search, userId, statsPromise };
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
        const setName = "Master Collection";
        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(setId, setName, "Auto-generated collection of all available locations.", userId).run();

        const { results: locations } = await db.prepare("SELECT id FROM locations").all<any>();
        const stmt = db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)");
        const batch = locations.map((loc: any, index: number) => stmt.bind(setId, loc.id, index));
        if (batch.length > 0) {
            await db.batch(batch);
        }
        return { success: true };
    }

    if (intent === "create_set") {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const id = crypto.randomUUID();

        if (!name) return { error: "Name is required" };

        await db.prepare(
            "INSERT INTO map_sets (id, name, description, created_by) VALUES (?, ?, ?, ?)"
        ).bind(id, name, description, userId).run();

        return { success: true };
    }

    if (intent === "delete_set") {
        const id = formData.get("id") as string;
        await db.prepare("DELETE FROM map_set_items WHERE set_id = ?").bind(id).run();
        await db.prepare("DELETE FROM map_sets WHERE id = ?").bind(id).run();
        return { success: true };
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

    const activeTab = searchParams.get("tab") || "overview";
    const isSubmitting = navigation.state === "submitting";
    const [editingLocId, setEditingLocId] = useState<string | null>(null);
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
        <div className="min-h-screen relative">
            {/* Header bar */}
            <header className="sticky top-0 z-50 bg-[#0e1a14]/95 backdrop-blur-xl border-b border-brass/10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div>
                            <h1 className="font-heading text-2xl font-black text-cream tracking-tight">Command Center</h1>
                            <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest">Field Operations</p>
                        </div>
                        <nav className="hidden md:flex items-center gap-1 ml-8">
                            <button onClick={() => switchTab("overview")} className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all ${activeTab === "overview" ? "text-brass bg-brass/10" : "text-stone hover:text-cream"}`}>Overview</button>
                            <button onClick={() => switchTab("simulation")} className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all ${activeTab === "simulation" ? "text-brass bg-brass/10" : "text-stone hover:text-cream"}`}>Simulation</button>
                            <button onClick={() => switchTab("datasets")} className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all ${activeTab === "datasets" ? "text-brass bg-brass/10" : "text-stone hover:text-cream"}`}>Collections</button>
                            <button onClick={() => switchTab("locations")} className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all ${activeTab === "locations" ? "text-brass bg-brass/10" : "text-stone hover:text-cream"}`}>Locations</button>
                        </nav>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-[9px] font-mono text-teal">
                            <div className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                            Online
                        </div>
                        <Form method="post" action="/logout">
                            <button className="px-4 py-2 text-[10px] font-mono text-stone hover:text-rust uppercase tracking-widest transition-colors border border-brass/10 hover:border-rust/30">
                                Exit
                            </button>
                        </Form>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* OVERVIEW TAB */}
                {activeTab === "overview" && (
                    <div className="space-y-8">
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Active Rooms</div>
                                <div className="text-4xl font-heading font-black text-teal">{activeRooms.length}</div>
                            </div>
                            <div className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Collections</div>
                                <div className="text-4xl font-heading font-black text-brass">{mapSets.length}</div>
                            </div>
                            <div className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Locations</div>
                                <div className="text-4xl font-heading font-black text-amber">{(locations.length > 0 ? Math.max(...locations.map((l: any) => 0)) : 0) || 0}</div>
                            </div>
                            <div className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Quality Index</div>
                                <div className="text-4xl font-heading font-black text-cream">--</div>
                            </div>
                        </div>

                        {/* Quick actions */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="p-8 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-sm bg-teal/20 border border-teal/30 flex items-center justify-center text-xl">🎯</div>
                                    <div>
                                        <h3 className="font-heading text-lg font-black text-cream">Launch Simulation</h3>
                                        <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest">Create new training session</p>
                                    </div>
                                </div>
                                {mapSets.length === 0 ? (
                                    <fetcher.Form method="post">
                                        <input type="hidden" name="intent" value="create_default_set" />
                                        <button className="w-full py-4 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest transition-all">
                                            Generate Master Collection
                                        </button>
                                    </fetcher.Form>
                                ) : (
                                    <Link to="?tab=simulation" onClick={() => switchTab("simulation")} className="block w-full py-4 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest text-center transition-all">
                                        Select Collection →
                                    </Link>
                                )}
                            </div>

                            <div className="p-8 bg-[#0a1210] border border-brass/10 rounded-sm">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-sm bg-brass/20 border border-brass/30 flex items-center justify-center text-xl">📍</div>
                                    <div>
                                        <h3 className="font-heading text-lg font-black text-cream">Deploy Location</h3>
                                        <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest">Add new target coordinates</p>
                                    </div>
                                </div>
                                <Link to="/admin/mass-add" className="block w-full py-4 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest text-center transition-all">
                                    Open Deploy Panel →
                                </Link>
                            </div>
                        </div>

                        {/* Active rooms summary */}
                        {activeRooms.length > 0 && (
                            <div>
                                <h2 className="font-heading text-xl font-black text-cream mb-4">Active Sessions</h2>
                                <div className="space-y-3">
                                    {activeRooms.slice(0, 3).map((room: any) => (
                                        <div key={room.code} className="flex items-center justify-between p-4 bg-[#0a1210] border border-brass/10 rounded-sm">
                                            <div className="flex items-center gap-4">
                                                <div className="w-3 h-3 rounded-full bg-teal animate-pulse" />
                                                <div>
                                                    <div className="font-mono text-lg font-black text-brass">{room.code}</div>
                                                    <div className="text-[10px] font-mono text-stone/50">{room.map_set_name || "Unknown"}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[9px] font-mono text-teal uppercase tracking-widest">{room.status}</span>
                                                <Link to={`/teacher/room/${room.code}`} className="px-4 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">
                                                    Control
                                                </Link>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* SIMULATION TAB */}
                {activeTab === "simulation" && (
                    <div className="space-y-8">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-heading text-2xl font-black text-cream">Deploy Simulation</h2>
                                <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest mt-1">Select a collection to launch</p>
                            </div>
                            {mapSets.length === 0 && (
                                <fetcher.Form method="post">
                                    <input type="hidden" name="intent" value="create_default_set" />
                                    <button className="px-4 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">
                                        + Generate Master
                                    </button>
                                </fetcher.Form>
                            )}
                        </div>

                        {mapSets.length === 0 ? (
                            <div className="p-12 border border-dashed border-brass/20 rounded-sm text-center">
                                <div className="text-4xl mb-4">📦</div>
                                <p className="text-stone mb-4">No collections available</p>
                                <fetcher.Form method="post">
                                    <input type="hidden" name="intent" value="create_default_set" />
                                    <button className="px-6 py-3 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest transition-all">
                                        Create Master Collection
                                    </button>
                                </fetcher.Form>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {mapSets.map((set: any) => (
                                    <div key={set.id} className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="px-2 py-1 bg-brass/10 border border-brass/20 text-brass text-[9px] font-mono uppercase tracking-widest">{set.item_count} targets</span>
                                        </div>
                                        <h3 className="font-heading text-xl font-black text-cream mb-2">{set.name}</h3>
                                        <p className="text-sm text-stone-light mb-6 line-clamp-2">{set.description || "No description"}</p>

                                        <Form method="post" className="space-y-4">
                                            <input type="hidden" name="intent" value="create_room" />
                                            <input type="hidden" name="setId" value={set.id} />

                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-1">Timer (s)</label>
                                                    <input type="number" name="timeLimit" defaultValue={120} min={30} max={600} className="w-full bg-[#0e1a14] border border-brass/10 px-3 py-2 text-cream text-sm font-mono focus:border-brass focus:outline-none" />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-1">Hints (s)</label>
                                                    <input type="number" name="hintInterval" defaultValue={30} min={10} max={120} className="w-full bg-[#0e1a14] border border-brass/10 px-3 py-2 text-cream text-sm font-mono focus:border-brass focus:outline-none" />
                                                </div>
                                            </div>

                                            <select name="curriculumFocus" className="w-full bg-[#0e1a14] border border-brass/10 px-3 py-2 text-cream text-xs font-mono focus:border-brass focus:outline-none">
                                                <option value="None">Default Rules</option>
                                                <option value="Architecture">Architecture</option>
                                                <option value="Transport">Transport</option>
                                                <option value="History">History</option>
                                                <option value="Environment">Environment</option>
                                            </select>

                                            <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-brass text-charcoal font-mono text-sm font-black uppercase tracking-widest hover:bg-brass/90 transition-all">
                                                Launch Mission
                                            </button>
                                        </Form>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Active rooms */}
                        {activeRooms.length > 0 && (
                            <div>
                                <h3 className="font-heading text-lg font-black text-cream mb-4">Active Sessions</h3>
                                <div className="space-y-3">
                                    {activeRooms.map((room: any) => (
                                        <div key={room.code} className="flex items-center justify-between p-4 bg-[#0a1210] border border-brass/10 rounded-sm">
                                            <div className="flex items-center gap-6">
                                                <div className="w-3 h-3 rounded-full bg-teal animate-pulse" />
                                                <div>
                                                    <div className="font-mono text-2xl font-black text-brass">{room.code}</div>
                                                    <div className="text-[10px] font-mono text-stone/50">{room.map_set_name}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="px-2 py-1 bg-teal/10 border border-teal/20 text-teal text-[9px] font-mono uppercase">{room.status}</span>
                                                <Link to={`/teacher/room/${room.code}`} className="px-4 py-2 bg-teal/10 hover:bg-teal/20 border border-teal/30 text-teal text-[10px] font-mono uppercase tracking-widest transition-all">
                                                    Control
                                                </Link>
                                                <fetcher.Form method="post" className="contents">
                                                    <input type="hidden" name="intent" value="delete_room" />
                                                    <input type="hidden" name="code" value={room.code} />
                                                    <button onClick={(e) => !confirm("End session?") && e.preventDefault()} className="px-3 py-2 bg-rust/10 hover:bg-rust/20 border border-rust/30 text-rust text-[10px] font-mono uppercase tracking-widest transition-all">
                                                        End
                                                    </button>
                                                </fetcher.Form>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* DATASETS TAB */}
                {activeTab === "datasets" && (
                    <div className="space-y-8">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Create form */}
                            <div className="lg:col-span-1">
                                <h2 className="font-heading text-xl font-black text-cream mb-4">New Collection</h2>
                                <Form method="post" className="p-6 bg-[#0a1210] border border-brass/10 rounded-sm space-y-4">
                                    <input type="hidden" name="intent" value="create_set" />
                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Name</label>
                                        <input type="text" name="name" required placeholder="e.g. Hong Kong Heritage" className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm focus:border-brass focus:outline-none placeholder-stone/30" />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Description</label>
                                        <textarea name="description" rows={3} placeholder="Learning objectives..." className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm focus:border-brass focus:outline-none placeholder-stone/30 leading-relaxed" />
                                    </div>
                                    <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-brass text-charcoal font-mono text-sm font-black uppercase tracking-widest hover:bg-brass/90 transition-all">
                                        Create Collection
                                    </button>
                                </Form>
                            </div>

                            {/* Collections list */}
                            <div className="lg:col-span-2">
                                <h2 className="font-heading text-xl font-black text-cream mb-4">Collections</h2>
                                {mapSets.length === 0 ? (
                                    <div className="p-8 border border-dashed border-brass/20 rounded-sm text-center text-stone/50">
                                        No collections created yet
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {mapSets.map((set: any) => (
                                            <div key={set.id} className="flex items-center justify-between p-4 bg-[#0a1210] border border-brass/10 rounded-sm">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-sm bg-brass/10 border border-brass/20 flex items-center justify-center font-mono text-brass text-lg">📦</div>
                                                    <div>
                                                        <h4 className="font-heading text-lg font-black text-cream">{set.name}</h4>
                                                        <p className="text-[10px] font-mono text-stone/50">{set.item_count} locations</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Link to={`/admin/datasets/${set.id}`} className="px-4 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">
                                                        Edit
                                                    </Link>
                                                    <fetcher.Form method="post" className="contents">
                                                        <input type="hidden" name="intent" value="delete_set" />
                                                        <input type="hidden" name="id" value={set.id} />
                                                        <button onClick={(e) => !confirm("Delete collection?") && e.preventDefault()} className="px-3 py-2 bg-rust/10 hover:bg-rust/20 border border-rust/30 text-rust text-[10px] font-mono uppercase tracking-widest transition-all">
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
                    </div>
                )}

                {/* LOCATIONS TAB */}
                {activeTab === "locations" && (
                    <div className="space-y-6">
                        {/* Toolbar */}
                        <div className="flex flex-wrap items-center gap-4">
                            <Form method="get" className="flex items-center gap-2 flex-grow max-w-md">
                                <input type="hidden" name="tab" value="locations" />
                                <input type="text" name="search" defaultValue={search} placeholder="Search coordinates..." className="flex-grow bg-[#0a1210] border border-brass/10 px-4 py-2 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30" />
                                <button type="submit" className="px-4 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">Search</button>
                            </Form>
                            {search && <Link to="?tab=locations" className="px-4 py-2 bg-rust/10 hover:bg-rust/20 border border-rust/30 text-rust text-[10px] font-mono uppercase tracking-widest transition-all">Clear</Link>}
                            <div className="flex-1" />
                            <a href="/api/admin/export-locations" download className="px-4 py-2 bg-[#0a1210] border border-brass/10 text-stone text-[10px] font-mono uppercase tracking-widest transition-all hover:border-brass/30">Export CSV</a>
                            <Link to="/admin/mass-add" className="px-4 py-2 bg-[#0a1210] border border-brass/10 text-stone text-[10px] font-mono uppercase tracking-widest transition-all hover:border-brass/30">Bulk Import</Link>
                            <Link to="/admin/add-location" className="px-5 py-2 bg-brass text-charcoal text-[10px] font-mono font-black uppercase tracking-widest transition-all hover:bg-brass/90">+ Deploy</Link>
                        </div>

                        {/* Locations grid */}
                        {locations.length === 0 ? (
                            <div className="p-12 border border-dashed border-brass/20 rounded-sm text-center text-stone/50">
                                No locations deployed yet
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {locations.map((loc: any) => {
                                    const isEditingThis = editingLocId === loc.id;
                                    return (
                                        <div key={loc.id} className="bg-[#0a1210] border border-brass/10 rounded-sm overflow-hidden group">
                                            <div className="h-32 relative overflow-hidden">
                                                <img src={`/resources/image/${loc.id}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="" loading="lazy" />
                                                <div className="absolute inset-0 bg-gradient-to-t from-[#0a1210] via-transparent to-transparent" />
                                                <div className="absolute top-3 right-3 px-2 py-1 bg-[#0e1a14]/80 border border-brass/20 text-brass text-[9px] font-mono">{loc.difficulty_rating.toFixed(1)}</div>
                                            </div>
                                            <div className="p-4">
                                                {isEditingThis ? (
                                                    <fetcher.Form method="post" onSubmit={() => setEditingLocId(null)} className="space-y-3">
                                                        <input type="hidden" name="intent" value="edit_location" />
                                                        <input type="hidden" name="locId" value={loc.id} />
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <input type="text" name="lat" value={editLat} onChange={(e) => setEditLat(e.target.value)} placeholder="Lat" className="bg-[#0e1a14] border border-brass/10 px-2 py-1 text-cream text-xs font-mono" />
                                                            <input type="text" name="lng" value={editLng} onChange={(e) => setEditLng(e.target.value)} placeholder="Lng" className="bg-[#0e1a14] border border-brass/10 px-2 py-1 text-cream text-xs font-mono" />
                                                            <input type="text" name="diff" value={editDiff} onChange={(e) => setEditDiff(e.target.value)} placeholder="Diff" className="bg-[#0e1a14] border border-brass/10 px-2 py-1 text-cream text-xs font-mono" />
                                                            <input type="text" name="quality" value={editQuality} onChange={(e) => setEditQuality(e.target.value)} placeholder="Quality" className="bg-[#0e1a14] border border-brass/10 px-2 py-1 text-cream text-xs font-mono" />
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button type="submit" className="flex-1 py-1.5 bg-teal/20 border border-teal/30 text-teal text-[10px] font-mono">Save</button>
                                                            <button type="button" onClick={() => setEditingLocId(null)} className="flex-1 py-1.5 bg-stone/10 border border-stone/20 text-stone text-[10px] font-mono">Cancel</button>
                                                        </div>
                                                    </fetcher.Form>
                                                ) : (
                                                    <>
                                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                                            <div className="text-[9px] font-mono text-stone/50 uppercase">Quality</div>
                                                            <div className="text-lg font-heading font-black text-cream">{loc.quality_score}%</div>
                                                            <div className="text-[9px] font-mono text-stone/50 uppercase">Coords</div>
                                                            <div className="text-[10px] font-mono text-stone-light">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => startEditing(loc)} className="flex-1 py-2 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass text-[10px] font-mono uppercase tracking-widest transition-all">Edit</button>
                                                            <fetcher.Form method="post" className="contents">
                                                                <input type="hidden" name="intent" value="delete_location" />
                                                                <input type="hidden" name="locId" value={loc.id} />
                                                                <button onClick={(e) => !confirm("Delete location?") && e.preventDefault()} className="px-3 py-2 bg-rust/10 hover:bg-rust/20 border border-rust/30 text-rust text-[10px] font-mono transition-all">✕</button>
                                                            </fetcher.Form>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-4 pt-4">
                                <Link to={`?tab=locations&page=${Math.max(1, page - 1)}&search=${search}`} className={`px-4 py-2 bg-[#0a1210] border border-brass/10 text-stone text-[10px] font-mono uppercase tracking-widest transition-all ${page === 1 ? "opacity-30 pointer-events-none" : ""}`}>Prev</Link>
                                <span className="text-[10px] font-mono text-stone/50">Page {page} / {totalPages}</span>
                                <Link to={`?tab=locations&page=${Math.min(totalPages, page + 1)}&search=${search}`} className={`px-4 py-2 bg-[#0a1210] border border-brass/10 text-stone text-[10px] font-mono uppercase tracking-widest transition-all ${page >= totalPages ? "opacity-30 pointer-events-none" : ""}`}>Next</Link>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}