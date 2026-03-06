import type { ActionFunctionArgs } from "react-router";
import { getUserId } from "~/lib/auth.server";
import { generateSocraticHint } from "~/lib/gemini.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
    const userId = await getUserId(request);
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const code = params.code;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
    if (!room) return new Response("Not Found", { status: 404 });

    const item = await db.prepare(
        "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
    ).bind(room.map_set_id, room.current_index).first<any>();

    if (!item) return new Response("Round not active", { status: 400 });

    let targetLocationId = item.location_id;
    // Guided Playthrough: index 0 = tutorial (default sim), index 1+ = dataset[index-1]
    if (room.current_index === 0 && room.has_guided_playthrough) {
        const defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
        if (defaultSim) {
            targetLocationId = defaultSim.id;
        }
    } else if (room.has_guided_playthrough) {
        const datasetIndex = room.current_index - 1;
        const realItem = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
        ).bind(room.map_set_id, datasetIndex).first<any>();
        if (realItem) {
            targetLocationId = realItem.location_id;
        }
    }

    const location = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>();

    const formData = await request.formData();
    const query = formData.get("query") as string || "I need a hint for this location.";

    try {
        const hint = await generateSocraticHint(
            location.image_url,
            location.name,
            query,
            room.curriculum_focus || "None",
            env.GEMINI_BASE_URL,
            env.GEMINI_GATEWAY_TOKEN
        );

        return Response.json({ success: true, hint });
    } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500 });
    }
}
