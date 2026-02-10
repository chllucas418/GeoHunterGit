import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const userId = await requireUser(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

    // Gatekeep: Only allow fetching results if status is REVIEW or PODIUM (or if round index moved past, but usually status covers it)
    if (room.status === 'PLAYING' || room.status === 'WAITING') {
        return Response.json({ error: "Results not available yet" }, { status: 403 });
    }

    // Get current round location (or previous if we just moved? usually reviewing current)
    // The "current_index" points to the item we are Playing or Reviewing.

    // Get Guess
    try {
        const item = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, room.current_index).first<any>();

        if (!item) return Response.json({ error: "Round data missing" }, { status: 404 });

        const guess = await db.prepare(
            "SELECT * FROM room_guesses WHERE room_code = ? AND location_id = ? AND user_id = ?"
        ).bind(code, item.location_id, userId).first<any>();

        if (!guess) {
            return Response.json({
                notSubmitted: true,
                message: "No submission for this round",
                officialLocation: await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>(),
                officialEvidence: (await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(item.location_id).all<any>()).results || []
            });
        }

        // Get Official Data (Location + Evidence)
        const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>();
        const evidence = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(item.location_id).all<any>();

        // Parse Guess Data
        let aiFeedback = null;
        try {
            aiFeedback = guess.ai_feedback ? JSON.parse(guess.ai_feedback) : null;
        } catch (e) {
            console.error("JSON Parse Error for AI Feedback", e);
        }

        let evidenceFound = [];
        try {
            evidenceFound = guess.evidence_found ? JSON.parse(guess.evidence_found) : [];
        } catch (e) { }

        return Response.json({
            score: guess.score,
            distance: guess.distance * 1000,
            distanceScore: guess.distance_score || 0,
            evidenceScore: guess.evidence_score || 0,
            aiFeedback,
            evidenceFound,
            officialLocation: location,
            officialEvidence: evidence.results || []
        });
    } catch (error) {
        console.error("ROUND RESULT ERROR:", error);
        return Response.json({ error: "Internal Server Error", details: (error as any).message }, { status: 500 });
    }
}
