import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { checkEvidenceListWithGemini, batchAnalyzeOfficialEvidence } from "~/lib/gemini.server";

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

        // --- REAL-TIME AI ANALYSIS (NO DB STORAGE) ---
        // 1. Prepare Inputs
        const adminBoxes = officialEvidence.map((ae: any) => ({
            id: ae.id,
            box: typeof ae.bounding_box === 'string' ? JSON.parse(ae.bounding_box) : ae.bounding_box,
            description: ae.description
        }));

        const studentEvidence = guess.ai_feedback ? JSON.parse(guess.ai_feedback) : [];

        let liveAiFeedback = null;
        let finalOfficialEvidence = [...officialEvidence];

        try {
            // Standardizing to static imports to fix build transformation issues
            // Resolved at top level now.

            // 2. Resolve Student Analysis Live
            if (studentEvidence.length >= 0) {
                liveAiFeedback = await checkEvidenceListWithGemini(
                    location.image_url,
                    studentEvidence,
                    location.name,
                    adminBoxes,
                    env.GEMINI_BASE_URL,
                    env.GEMINI_GATEWAY_TOKEN,
                    env.GEMINI_API_KEY
                );
            }

            // 3. Resolve Official Analysis Live (e.g. for Missed Intel)
            // We can just analyze ALL official evidence live as requested
            const officialAnalysis = await batchAnalyzeOfficialEvidence(
                location.image_url,
                adminBoxes,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY
            );

            // Merge live analysis back to official items for return
            finalOfficialEvidence = officialEvidence.map(oe => {
                const analysis = officialAnalysis.find((a: any) => a.id === oe.id);
                return { ...oe, ai_analysis: analysis?.ai_analysis || "Analysis unavailable." };
            });

        } catch (e) {
            console.error("[RoundResult] Real-time Analysis Failed:", e);
            liveAiFeedback = { error: "Live analysis failed", results: [] };
        }

        // Parse matched IDs
        let evidenceFound = [];
        try {
            evidenceFound = guess.evidence_found ? JSON.parse(guess.evidence_found) : [];
        } catch (e) { }

        return Response.json({
            score: guess.score,
            distance: guess.distance * 1000,
            distanceScore: guess.distance_score || 0,
            evidenceScore: guess.evidence_score || 0,
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
