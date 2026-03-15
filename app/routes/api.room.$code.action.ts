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
        // [BYOK/REAL-TIME] We no longer pre-generate AI analysis here.
        // Analysis is generated in real-time when participants load the review page.
        
        // 1. Move to review
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
        
        const gameMode = formData.get("gameMode") as string;
        if (gameMode && ['standard', 'teams', 'time_attack'].includes(gameMode)) {
            await db.prepare(
                "UPDATE rooms SET game_mode = ? WHERE code = ?"
            ).bind(gameMode, code).run();
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

    return Response.json({ success: true });
}
