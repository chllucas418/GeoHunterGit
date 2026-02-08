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

    // Get Location ID for that round (correctly using OFFSET)
    const item = await db.prepare(
        "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
    ).bind(room.map_set_id, roundIndex).first<any>();

    if (!item) return Response.json({ guesses: [] });

    // Get Location Data
    const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>();
    const evidence = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(item.location_id).all<any>();

    // Fetch Guesses with User Names
    const guesses = await db.prepare(`
        SELECT rg.lat, rg.lng, rg.score, rg.distance, rg.evidence_score, rg.distance_score, u.display_name, u.profile_picture_url, rg.timestamp, rg.evidence_found
        FROM room_guesses rg
        JOIN users u ON rg.user_id = u.id
        WHERE rg.room_code = ? AND rg.location_id = ?
    `).bind(code, item.location_id).all<any>();

    return Response.json({
        guesses: guesses.results || [],
        officialLocation: location,
        officialEvidence: evidence.results || []
    });
}
