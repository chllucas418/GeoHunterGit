import type { LoaderFunctionArgs } from "react-router";
import { requireTeacher } from "~/lib/auth.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const userId = await requireTeacher(request);
    const code = params.code;
    const url = new URL(request.url);
    const index = url.searchParams.get("round"); // Note: we access by round index to sync valid guesses

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // We need map_set_id to find location_id from index
    const room = await db.prepare("SELECT map_set_id FROM rooms WHERE code = ?").bind(code).first<any>();
    if (!room) return Response.json({ error: "No room" }, { status: 404 });

    const item = await db.prepare(
        "SELECT location_id FROM map_set_items WHERE set_id = ? AND order_index = ?"
    ).bind(room.map_set_id, index).first<any>();

    if (!item) return Response.json({ guesses: [] });

    const { results: guesses } = await db.prepare(`
        SELECT rg.lat, rg.lng, rg.distance, rg.score, u.display_name as user_name
        FROM room_guesses rg
        JOIN users u ON rg.user_id = u.id
        WHERE rg.room_code = ? AND rg.location_id = ?
    `).bind(code, item.location_id).all<any>();

    return Response.json({ guesses });
}
