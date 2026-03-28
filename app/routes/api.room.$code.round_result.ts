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
        // Guided playthrough: index 0 = tutorial (default sim), index 1+ = dataset[index-1]
        const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;
        let targetLocationId: string;

        if (isGuidedRound) {
            const defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
            if (!defaultSim) return Response.json({ error: "Tutorial location not found" }, { status: 404 });
            targetLocationId = defaultSim.id;
        } else {
            const datasetIndex = room.has_guided_playthrough ? room.current_index - 1 : room.current_index;
            const item = await db.prepare(
                "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
            ).bind(room.map_set_id, datasetIndex).first<any>();
            if (!item) return Response.json({ error: "Round data missing" }, { status: 404 });
            targetLocationId = item.location_id;
        }

        const guess = await db.prepare(
            "SELECT * FROM room_guesses WHERE room_code = ? AND location_id = ? AND user_id = ?"
        ).bind(code, targetLocationId, userId).first<any>();

        if (!guess) {
            return Response.json({
                notSubmitted: true,
                message: "No submission for this round",
                officialLocation: await db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>(),
                officialEvidence: (await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(targetLocationId).all<any>()).results || []
            });
        }


        // Get Official Data (Location + Evidence)
        const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>();
        const evidenceResult = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ? AND created_by_user_id IS NULL").bind(targetLocationId).all<any>();
        const officialEvidence = evidenceResult.results || [];

        // Skip massive 10s Gemini re-roll — just use the data generated at submission time
        let liveAiFeedback = null;
        try {
            liveAiFeedback = guess.ai_feedback ? JSON.parse(guess.ai_feedback) : null;
        } catch (e) {
            console.error("Failed to parse saved AI feedback", e);
        }
        
        const finalOfficialEvidence = [...officialEvidence];

        // Parse matched IDs
        let evidenceFound = [];
        try {
            evidenceFound = guess.evidence_found ? JSON.parse(guess.evidence_found) : [];
        } catch (e) { }

        // Re-derive Time Score and Difficulty from DB values
        const TIME_LIMIT = room.time_limit || 120;
        let elapsedSeconds = 0;
        if (room.round_start_time && guess.timestamp) {
            elapsedSeconds = Math.max(0, (guess.timestamp - room.round_start_time) / 1000);
        }
        let derivedTimeScore = 0;
        if (elapsedSeconds < TIME_LIMIT) {
            derivedTimeScore = Math.round(1000 * (1 - elapsedSeconds / TIME_LIMIT));
        }

        const isDifficultyHard = (location.difficulty_rating || 0) >= 8;
        const difficultyMulti = isDifficultyHard ? 2 : 1;

        return Response.json({
            score: guess.score,
            distance: guess.distance * 1000,
            distanceScore: guess.distance_score || 0,
            evidenceScore: guess.evidence_score || 0,
            timeScore: derivedTimeScore,
            difficultyMulti,
            aiFeedback: liveAiFeedback,
            evidenceFound,
            officialLocation: location,
            officialEvidence: finalOfficialEvidence
        });
    } catch (error) {
        console.error("ROUND RESULT ERROR:", error);
        return Response.json({ error: "Internal Server Error", details: (error as any).message }, { status: 500 });
    }
}
