import type { LoaderFunctionArgs } from "react-router";
import { requireTeacher } from "~/lib/auth.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    await requireTeacher(request); // Security check
    const code = params.code;
    const url = new URL(request.url);
    const roundIndexParam = url.searchParams.get("round");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

    const roundIndex = roundIndexParam ? parseInt(roundIndexParam) : room.current_index;

    // Guided playthrough: index 0 = tutorial (default sim), index 1+ = dataset[index-1]
    const isGuidedRound = roundIndex === 0 && room.has_guided_playthrough;
    let targetLocationId: string;

    if (isGuidedRound) {
        let defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
        if (!defaultSim) {
            defaultSim = await db.prepare("SELECT id FROM locations ORDER BY created_at ASC LIMIT 1").first<any>();
        }
        if (!defaultSim) return Response.json({ guesses: [] });
        targetLocationId = defaultSim.id;
    } else {
        const datasetIndex = room.has_guided_playthrough ? roundIndex - 1 : roundIndex;
        const item = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, datasetIndex).first<any>();
        if (!item) return Response.json({ guesses: [] });
        targetLocationId = item.location_id;
    }

    // Get Location Data
    const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>();
    const evidence = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(targetLocationId).all<any>();

    // Fetch Guesses with User Names
    const guesses = await db.prepare(`
        SELECT rg.lat, rg.lng, rg.score, rg.distance, rg.evidence_score, rg.distance_score, u.display_name, u.profile_picture_url, rg.timestamp, rg.evidence_found, rp.team_id
        FROM room_guesses rg
        JOIN users u ON rg.user_id = u.id
        LEFT JOIN room_participants rp ON rg.user_id = rp.user_id AND rg.room_code = rp.room_code
        WHERE rg.room_code = ? AND rg.location_id = ?
    `).bind(code, targetLocationId).all<any>();

    return Response.json({
        guesses: guesses.results || [],
        officialLocation: location,
        officialEvidence: evidence.results || []
    });
}
