import type { ActionFunctionArgs } from "react-router";
import { requireTeacher, getUserId } from "~/lib/auth.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
    await requireTeacher(request);
    const userId = await getUserId(request);
    const code = params.code;
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (request.method === "DELETE") {
        const formData = await request.formData();
        const studentId = formData.get("studentId") as string;

        if (!studentId) {
            return Response.json({ error: "Student ID required" }, { status: 400 });
        }

        // Verify Host
        const room = await db.prepare("SELECT host_id FROM rooms WHERE code = ?").bind(code).first<any>();
        if (!room || room.host_id !== userId) {
            return Response.json({ error: "Unauthorized" }, { status: 403 });
        }

        // Remove from Participants
        await db.prepare("DELETE FROM room_participants WHERE room_code = ? AND user_id = ?").bind(code, studentId).run();

        // Remove their Guesses? Maybe keep them for records, but usually kick means remove.
        await db.prepare("DELETE FROM room_guesses WHERE room_code = ? AND user_id = ?").bind(code, studentId).run();

        return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
}
