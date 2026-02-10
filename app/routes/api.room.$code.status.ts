import type { LoaderFunctionArgs } from "react-router";

// Helper to safely serialize BigInt and other types for JSON response
function safeJson(data: any) {
    return JSON.parse(JSON.stringify(data, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();

    if (!room) {
        return Response.json({ error: "Room not found" }, { status: 404 });
    }

    // Parallelize fetching Participants and Map/Item Basic Info
    const [participantsResult, mapSetInfo] = await Promise.all([
        db.prepare(`
            SELECT rp.*, u.display_name, u.profile_picture_url 
            FROM room_participants rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_code = ? 
            ORDER BY rp.score DESC
        `).bind(code).all<any>(),

        // Combine Total + Current Item check if map_set_id exists
        room.map_set_id ? Promise.all([
            db.prepare("SELECT COUNT(*) as count FROM map_set_items WHERE set_id = ?").bind(room.map_set_id).first<any>(),
            db.prepare(
                "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
            ).bind(room.map_set_id, room.current_index).first<any>()
        ]) : Promise.resolve([null, null])
    ]);

    const participants = participantsResult.results || [];
    const [total, item] = mapSetInfo;

    // Current Round Info
    let currentRound = null;

    if (item) {
        // Parallelize fetching Location Details, Evidence, and Submission Count
        // Only fetch Location & Evidence if we have an item
        const [location, allEvidence, submissionCountResult] = await Promise.all([
            db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>(),
            db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(item.location_id).all<any>(),
            db.prepare(
                "SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?"
            ).bind(code, item.location_id).first<any>()
        ]);

        // Masking Logic
        let maskedLocation = { ...location };
        if (room.status === 'PLAYING') {
            delete maskedLocation.lat;
            delete maskedLocation.lng;
        }

        let evidence: any[] = [];
        if (room.status === 'REVIEW') {
            evidence = allEvidence.results || [];
        }

        const evidenceCount = allEvidence.results?.length || 0;

        currentRound = {
            index: room.current_index,
            total: total.count,
            startTime: room.round_start_time,
            location: maskedLocation,
            evidence: evidence,
            evidenceCount: evidenceCount,
            focusedEvidenceId: room.focused_evidence_id,
            submissionCount: submissionCountResult?.count || 0,
            timeLimit: room.time_limit || 120
        };
    }

    // Use safeJson to handle potential BigInts (e.g. from COUNT or Timestamps)
    return Response.json(safeJson({
        room,
        participants,
        currentRound
    }));
}
