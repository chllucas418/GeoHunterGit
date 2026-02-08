import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();

    if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
    }

    // Participants
    const participants = await db.prepare(
        "SELECT * FROM room_participants WHERE room_code = ? ORDER BY score DESC"
    ).bind(code).all<any>();

    // Current Round Info
    let currentRound = null;
    if (room.map_set_id) {
        // Get total count
        const total = await db.prepare("SELECT COUNT(*) as count FROM map_set_items WHERE set_id = ?").bind(room.map_set_id).first<any>();

        // Get current item
        const item = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, room.current_index).first<any>();

        if (item) {
            const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>();
            // If in PLAYING mode, hide the Official Evidence from the client to prevent cheating?
            // Actually, location data usually includes image_url.
            // We should NOT send "evidence" or "correct coordinates" if the user is a student?
            // But this endpoint is public.
            // Teacher needs it for Review. Student needs it for Image.
            // Best practice: Only send `lat/lng` if status is REVIEW or PODIUM?
            // For now, let's allow it but maybe frontend hides it.
            // Wait, if student inspects network, they see lat/lng.
            // Ideally, we should mask lat/lng if status == PLAYING.

            // Masking Logic
            let maskedLocation = { ...location };
            if (room.status === 'PLAYING') {
                delete maskedLocation.lat;
                delete maskedLocation.lng;
                // Also hide hints if we want to reveal them slowly on server side?
                // For now, just hiding answers is enough.
            }

            // Evidence
            // Only fetch evidence if needed (e.g. for Review)
            let evidence = [];
            if (room.status === 'REVIEW') {
                const evResult = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(item.location_id).all<any>();
                evidence = evResult.results || [];
            }

            // Submission Count (for Loading Status)
            const submissionCount = await db.prepare(
                "SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?"
            ).bind(code, item.location_id).first<any>();

            currentRound = {
                index: room.current_index,
                total: total.count,
                startTime: room.round_start_time,
                location: maskedLocation,
                evidence: evidence,
                submissionCount: submissionCount?.count || 0
            };
        }
    }

    return Response.json({
        room,
        participants: participants.results || [],
        currentRound
    });
}
