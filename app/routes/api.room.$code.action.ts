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
        
        try {
            const id = env.GEOHUNTER_ROOM_DO.idFromName(code);
            const obj = env.GEOHUNTER_ROOM_DO.get(id);
            await obj.fetch(new Request("http://internal/broadcast", {
                method: "POST",
                body: JSON.stringify({ type: "pause_toggle" }) // Triggers client state reload
            }));
        } catch (e) { console.error("Broadcast failed", e); }
    }

    if (action === "SKIP_TIMER") {
        // 1. Move to review
        await db.prepare(
            "UPDATE rooms SET status = 'REVIEW' WHERE code = ?"
        ).bind(code).run();
        
        try {
            const id = env.GEOHUNTER_ROOM_DO.idFromName(code);
            const obj = env.GEOHUNTER_ROOM_DO.get(id);
            await obj.fetch(new Request("http://internal/broadcast", {
                method: "POST",
                body: JSON.stringify({ type: "pause_toggle" }) 
            }));
        } catch (e) { console.error("Broadcast failed", e); }
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

        try {
            const id = env.GEOHUNTER_ROOM_DO.idFromName(code);
            const obj = env.GEOHUNTER_ROOM_DO.get(id);
            await obj.fetch(new Request("http://internal/broadcast", {
                method: "POST",
                body: JSON.stringify({ type: "pause_toggle" }) 
            }));
        } catch (e) { console.error("Broadcast failed", e); }
    }

    if (action === "UPDATE_SETTINGS") {
        const hintInterval = parseInt(formData.get("hintInterval") as string);
        if (hintInterval && hintInterval > 0) {
            await db.prepare(
                "UPDATE rooms SET hint_interval = ? WHERE code = ?"
            ).bind(hintInterval, code).run();
        }
        
        const gameMode = formData.get("gameMode") as string;
        if (gameMode && ['standard', 'teams', 'time_attack'].includes(gameMode)) {
            await db.prepare(
                "UPDATE rooms SET game_mode = ? WHERE code = ?"
            ).bind(gameMode, code).run();
        }

        const taMax = parseFloat(formData.get("taMax") as string);
        if (!isNaN(taMax)) {
            await db.prepare("UPDATE rooms SET ta_max_multiplier = ? WHERE code = ?").bind(taMax, code).run();
        }

        const taMin = parseFloat(formData.get("taMin") as string);
        if (!isNaN(taMin)) {
            await db.prepare("UPDATE rooms SET ta_min_multiplier = ? WHERE code = ?").bind(taMin, code).run();
        }

        const taGrace = parseInt(formData.get("taGrace") as string);
        if (!isNaN(taGrace)) {
            await db.prepare("UPDATE rooms SET ta_grace_period = ? WHERE code = ?").bind(taGrace, code).run();
        }
    }

    if (action === "ASSIGN_TEAMS") {
        const teamCount = parseInt(formData.get("teamCount") as string) || 2;
        const participants = await db.prepare("SELECT user_id FROM room_participants WHERE room_code = ?").bind(code).all<any>();
        
        if (participants.results && participants.results.length > 0) {
            // Shuffle
            const shuffled = [...participants.results].sort(() => 0.5 - Math.random());
            const teamNames = ["Red Team", "Blue Team", "Green Team", "Yellow Team"];
            
            const statements = [];
            for (let i = 0; i < shuffled.length; i++) {
                const p = shuffled[i];
                const teamName = teamNames[i % teamCount];
                statements.push(
                    db.prepare("UPDATE room_participants SET team_id = ? WHERE room_code = ? AND user_id = ?")
                    .bind(teamName, code, p.user_id)
                );
            }
            if (statements.length > 0) {
                await db.batch(statements);
            }
        }
    }

    if (action === "TOGGLE_PAUSE") {
        const isPaused = formData.get("isPaused") === "true" ? 1 : 0;
        await db.prepare(
            "UPDATE rooms SET is_paused = ? WHERE code = ?"
        ).bind(isPaused, code).run();
    }

    if (action === "ASSIGN_USER_TEAM") {
        const targetUserId = formData.get("userId") as string;
        const teamId = formData.get("teamId") as string | null;
        if (targetUserId) {
            const resolvedTeam = teamId === "NONE" ? null : (teamId || null);
            await db.prepare(
                "UPDATE room_participants SET team_id = ? WHERE room_code = ? AND user_id = ?"
            ).bind(resolvedTeam, code, targetUserId).run();
        }
    }

    if (action === "ANALYZE_EVIDENCE") {
        const evidenceId = formData.get("evidenceId") as string;
        if (!evidenceId) {
            return Response.json({ error: "Evidence ID required" }, { status: 400 });
        }

        // Get the evidence record
        const evidence = await db.prepare("SELECT * FROM map_evidence WHERE id = ?").bind(evidenceId).first<any>();
        if (!evidence) {
            return Response.json({ error: "Evidence not found" }, { status: 404 });
        }

        // Get the location for image URL
        const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(evidence.location_id).first<any>();
        if (!location || !location.image_url) {
            return Response.json({ error: "Location image not found" }, { status: 404 });
        }

        try {
            // Import the Gemini helper
            const { checkEvidenceListWithGemini } = await import("~/lib/gemini.server");

            const GEMINI_BASE_URL = env.GEMINI_BASE_URL;
            const GEMINI_GATEWAY_TOKEN = env.GEMINI_GATEWAY_TOKEN;
            const GEMINI_API_KEY = env.GEMINI_API_KEY;

            // Parse the bounding box
            let box = evidence.bounding_box;
            if (typeof box === "string") {
                try { box = JSON.parse(box); } catch { box = null; }
            }

            // Analyze single evidence item
            const result = await checkEvidenceListWithGemini(
                location.image_url,
                [{ box, description: evidence.description }],
                location.name,
                [{ id: evidence.id, box, description: evidence.description }],
                GEMINI_BASE_URL,
                GEMINI_GATEWAY_TOKEN,
                GEMINI_API_KEY,
                undefined,
                location.lat,
                location.lng
            );

            // Extract the analysis for this evidence item
            const analysisResult = result.results?.[0];

            if (analysisResult) {
                const analysis = analysisResult.explanation || analysisResult.description || "Analysis complete.";

                // Update the evidence record with the AI analysis
                await db.prepare(
                    "UPDATE map_evidence SET ai_analysis = ? WHERE id = ?"
                ).bind(analysis, evidenceId).run();

                return Response.json({
                    success: true,
                    evidenceId,
                    ai_analysis: analysis,
                    description: analysisResult.description || evidence.description,
                    validity: analysisResult.validity
                });
            } else {
                return Response.json({ error: "No analysis generated" }, { status: 500 });
            }
        } catch (e) {
            console.error("AI Analysis error:", e);
            return Response.json({ error: "AI analysis failed", details: (e as any).message }, { status: 500 });
        }
    }

    return Response.json({ success: true });
}
