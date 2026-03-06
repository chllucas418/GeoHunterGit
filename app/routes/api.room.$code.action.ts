import type { ActionFunctionArgs } from "react-router";
import { getUserId, requireTeacher } from "~/lib/auth.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
    const code = params.code;
    await requireTeacher(request);
    const userId = await getUserId(request) as string;
    const formData = await request.formData();
    const action = formData.get("action");

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    if (!room || room.host_id !== userId) {
        return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (action === "START_GAME") {
        await db.prepare(
            "UPDATE rooms SET status = 'PLAYING', current_index = 0, round_start_time = ? WHERE code = ?"
        ).bind(Date.now(), code).run();
    }

    if (action === "SKIP_TIMER") {
        // 1. Trigger AI Analysis for Official Evidence if missing (On-Demand)
        try {
            const roomData = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
            if (roomData && roomData.map_set_id) {
                const isGuidedRound = roomData.current_index === 0 && roomData.has_guided_playthrough;
                let targetLocationId: string | null = null;

                if (isGuidedRound) {
                    const defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
                    if (defaultSim) targetLocationId = defaultSim.id;
                } else {
                    const datasetIndex = roomData.has_guided_playthrough ? roomData.current_index - 1 : roomData.current_index;
                    const item = await db.prepare(
                        "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
                    ).bind(roomData.map_set_id, datasetIndex).first<any>();
                    if (item) targetLocationId = item.location_id;
                }

                if (targetLocationId) {
                    const evidenceResult = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(targetLocationId).all<any>();
                    const officialEvidence = evidenceResult.results || [];
                    const missingAnalysis = officialEvidence.filter((e: any) => !e.ai_analysis || e.ai_analysis === "Analysis unavailable." || e.ai_analysis.startsWith("Analysis failed:"));

                    if (missingAnalysis.length > 0) {
                        console.log(`[Action:SKIP_TIMER] Found ${missingAnalysis.length} items missing analysis. Triggering AI...`);
                        const { batchAnalyzeOfficialEvidence } = await import("~/lib/gemini.server");
                        const location = await db.prepare("SELECT image_url FROM locations WHERE id = ?").bind(targetLocationId).first<any>();

                        if (location && location.image_url && env.GEMINI_BASE_URL) {
                            const itemsToAnalyze = missingAnalysis.map((e: any) => ({
                                id: e.id,
                                box: typeof e.bounding_box === 'string' ? JSON.parse(e.bounding_box) : e.bounding_box,
                                description: e.description
                            }));
                            const analysisResults = await batchAnalyzeOfficialEvidence(
                                location.image_url, itemsToAnalyze,
                                env.GEMINI_BASE_URL, env.GEMINI_GATEWAY_TOKEN
                            );
                            for (const res of analysisResults) {
                                if (res.ai_analysis) {
                                    await db.prepare("UPDATE map_evidence SET ai_analysis = ? WHERE id = ?")
                                        .bind(res.ai_analysis, res.id).run();
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[Action:SKIP_TIMER] AI Analysis Error:", e);
        }

        // 2. Move to review
        await db.prepare(
            "UPDATE rooms SET status = 'REVIEW' WHERE code = ?"
        ).bind(code).run();
    }

    if (action === "NEXT_ROUND") {
        // Check if more rounds
        const { results: items } = await db.prepare(
            "SELECT * FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC"
        ).bind(room.map_set_id).all<any>();

        const nextIndex = room.current_index + 1;

        // Account for guided playthrough: total rounds = dataset length + 1
        const totalRounds = room.has_guided_playthrough ? items.length + 1 : items.length;

        if (nextIndex >= totalRounds) {
            // End of game -> PODIUM
            await db.prepare(
                "UPDATE rooms SET status = 'PODIUM' WHERE code = ?"
            ).bind(code).run();
        } else {
            // Next Round
            await db.prepare(
                "UPDATE rooms SET status = 'PLAYING', current_index = ?, round_start_time = ? WHERE code = ?"
            ).bind(nextIndex, Date.now(), code).run();
        }
    }

    if (action === "UPDATE_SETTINGS") {
        const hintInterval = parseInt(formData.get("hintInterval") as string);
        if (hintInterval && hintInterval > 0) {
            await db.prepare(
                "UPDATE rooms SET hint_interval = ? WHERE code = ?"
            ).bind(hintInterval, code).run();
        }
    }

    if (action === "TOGGLE_PAUSE") {
        const isPaused = formData.get("isPaused") === "true" ? 1 : 0;
        await db.prepare(
            "UPDATE rooms SET is_paused = ? WHERE code = ?"
        ).bind(isPaused, code).run();
    }

    return Response.json({ success: true });
}
