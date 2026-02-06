import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // 1. Get Room State
    const room = await db.prepare(
        "SELECT * FROM rooms WHERE code = ?"
    ).bind(code).first<any>();

    if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
    }

    // 2. Get Participants (Scoreboard)
    const { results: participants } = await db.prepare(
        `SELECT u.display_name, rp.score, rp.streak 
         FROM room_participants rp
         JOIN users u ON rp.user_id = u.id
         WHERE rp.room_code = ?
         ORDER BY rp.score DESC`
    ).bind(code).all<any>();

    // 3. Get Current Round Info (if playing/review)
    let currentRound = null;
    if (room.status !== 'WAITING' && room.status !== 'PODIUM') {
        const { results: items } = await db.prepare(
            "SELECT * FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC"
        ).bind(room.map_set_id).all<any>();

        const currentItem = items[room.current_index];
        if (currentItem) {
            const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(currentItem.location_id).first<any>();

            // Fetch Evidence only if REVIEW (or PODIUM) to prevent spoilers
            let evidence = [];
            if (room.status === 'REVIEW' || room.status === 'PODIUM') {
                const { results } = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(location.id).all<any>();
                evidence = results;
            }

            currentRound = {
                index: room.current_index,
                total: items.length,
                startTime: room.round_start_time,
                location: location,
                evidence: evidence
            };
        }
    }

    return Response.json({
        room: {
            code: room.code,
            status: room.status,
            hostId: room.host_id
        },
        participants,
        currentRound
    });
}
