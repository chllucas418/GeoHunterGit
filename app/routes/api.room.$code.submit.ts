import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
// Inline helper for now just in case
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function action({ request, params, context }: ActionFunctionArgs) {
    const userId = await requireUser(request);
    const code = params.code;
    const formData = await request.formData();
    const lat = parseFloat(formData.get("lat") as string);
    const lng = parseFloat(formData.get("lng") as string);

    // We need locationId to verify against current round, 
    // BUT safest is to look up current round location from DB to prevent cheating

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    if (room.status !== 'PLAYING') {
        return Response.json({ error: "Round not active" }, { status: 400 });
    }

    // Get Current Location
    const item = await db.prepare(
        "SELECT location_id FROM map_set_items WHERE set_id = ? AND order_index = ?"
    ).bind(room.map_set_id, room.current_index).first<any>();

    if (!item) {
        console.error(`Map Item not found for Set ${room.map_set_id} Index ${room.current_index}`);
        return Response.json({ error: "Location data missing for this round" }, { status: 500 });
    }

    const trueLoc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>();

    if (!trueLoc) {
        return Response.json({ error: "Target location not found in database" }, { status: 500 });
    }

    // Determine Score
    // 5000 pts max. 
    // Distance factor
    const dist = getDistance(lat, lng, trueLoc.lat, trueLoc.lng);
    let pts = 0;
    if (dist < 0.1) pts = 5000;
    else if (dist < 2000) pts = Math.max(0, 5000 * Math.exp(-dist / 2000)); // Standard GuessCurve

    // Time Bonus? (Optional, maybe later)

    pts = Math.round(pts);

    // Save Guess
    await db.prepare(
        "INSERT INTO room_guesses (room_code, location_id, user_id, lat, lng, score, distance, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(code, trueLoc.id, userId, lat, lng, pts, dist, Date.now()).run();

    // Update Participant Totals
    await db.prepare(
        "UPDATE room_participants SET score = score + ? WHERE room_code = ? AND user_id = ?"
    ).bind(pts, code, userId).run();

    return Response.json({ success: true, points: pts, distance: dist });
}
