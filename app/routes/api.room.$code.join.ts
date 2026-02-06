import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
    const userId = await requireUser(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first();
    if (!room) {
        return Response.json({ error: "Invalid Room Code" }, { status: 404 });
    }

    try {
        await db.prepare(
            "INSERT INTO room_participants (room_code, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
        ).bind(code, userId).run();

        return Response.json({ success: true });
    } catch (e) {
        return Response.json({ error: "Failed to join" }, { status: 500 });
    }
}
