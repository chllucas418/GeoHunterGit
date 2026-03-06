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
            ).bind(room.map_set_id, room.has_guided_playthrough && room.current_index > 0 ? room.current_index - 1 : room.current_index).first<any>()
        ]) : Promise.resolve([null, null])
    ]);

    const participants = participantsResult.results || [];
    const [total, item] = mapSetInfo;

    let currentRound = null;

    // Guided playthrough: index 0 = tutorial (default sim), index 1+ = dataset[index-1]
    const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;

    if (isGuidedRound) {
        // Tutorial round — use default simulation location
        const defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
        if (defaultSim) {
            const totalResult = total || { count: 0 };
            const [location, allEvidence, submissionCountResult] = await Promise.all([
                db.prepare("SELECT * FROM locations WHERE id = ?").bind(defaultSim.id).first<any>(),
                db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(defaultSim.id).all<any>(),
                db.prepare(
                    "SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?"
                ).bind(code, defaultSim.id).first<any>()
            ]);
            let evidence: any[] = [];
            if (room.status === 'REVIEW') evidence = allEvidence.results || [];
            const evidenceCount = allEvidence.results?.length || 0;
            currentRound = {
                index: room.current_index,
                total: (totalResult.count || 0) + 1, // +1 for tutorial round
                startTime: room.round_start_time,
                location: location,
                evidence,
                evidenceCount,
                focusedEvidenceId: room.focused_evidence_id,
                submissionCount: submissionCountResult?.count || 0,
                timeLimit: room.time_limit || 120,
                isGuidedRound: true
            };
        }
    } else if (item) {
        // Real game round 
        const realItem = item;

        if (realItem) {
            const targetLocationId = realItem.location_id;
            const [location, allEvidence, submissionCountResult] = await Promise.all([
                db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>(),
                db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(targetLocationId).all<any>(),
                db.prepare(
                    "SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?"
                ).bind(code, targetLocationId).first<any>()
            ]);

            let evidence: any[] = [];
            if (room.status === 'REVIEW') {
                evidence = allEvidence.results || [];
            }

            const evidenceCount = allEvidence.results?.length || 0;
            const totalRounds = room.has_guided_playthrough ? (total?.count || 0) + 1 : (total?.count || 0);

            currentRound = {
                index: room.current_index,
                total: totalRounds,
                startTime: room.round_start_time,
                location: location,
                evidence: evidence,
                evidenceCount: evidenceCount,
                focusedEvidenceId: room.focused_evidence_id,
                submissionCount: submissionCountResult?.count || 0,
                timeLimit: room.time_limit || 120,
                isGuidedRound: false
            };
        }
    }

    // Use safeJson to handle potential BigInts (e.g. from COUNT or Timestamps)
    return Response.json(safeJson({
        room,
        participants,
        currentRound
    }));
}
