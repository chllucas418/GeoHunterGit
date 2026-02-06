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
        // Move directly to review
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

        if (nextIndex >= items.length) {
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

    return Response.json({ success: true });
}
