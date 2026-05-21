import type { LoaderFunctionArgs } from "react-router";
import { requireTeacher } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireTeacher(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Join game_sessions with users and locations to get comprehensive data
    const query = `
        SELECT 
            gs.id as session_id,
            gs.timestamp as play_time,
            gs.guess_lat,
            gs.guess_lng,
            gs.score,
            gs.ai_feedback,
            u.id as user_id,
            u.display_name as user_name,
            u.email as user_email,
            l.id as location_id,
            l.name as location_name,
            l.difficulty_rating
        FROM game_sessions gs
        LEFT JOIN users u ON gs.user_id = u.id
        LEFT JOIN locations l ON gs.location_id = l.id
        ORDER BY gs.timestamp DESC
    `;

    const { results: sessions } = await db.prepare(query).all<any>();

    // Generate CSV Header
    let csvString = "Session ID,Play Time,User ID,User Name,User Email,Location ID,Location Name,Difficulty Rating,Guess Lat,Guess Lng,Score,AI Feedback\n";

    // Escape CSV fields helper
    const escapeCsv = (str: any) => {
        if (str === null || str === undefined) return "";
        const stringified = String(str);
        if (stringified.includes(",") || stringified.includes('"') || stringified.includes("\n")) {
            return `"${stringified.replace(/"/g, '""')}"`;
        }
        return stringified;
    };

    // Populate Rows
    sessions.forEach(session => {
        const row = [
            session.session_id,
            session.play_time,
            session.user_id,
            session.user_name,
            session.user_email,
            session.location_id,
            session.location_name,
            session.difficulty_rating,
            session.guess_lat,
            session.guess_lng,
            session.score,
            session.ai_feedback
        ].map(escapeCsv).join(",");
        
        csvString += row + "\n";
    });

    return new Response(csvString, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="geohunter_sessions_${new Date().toISOString().split('T')[0]}.csv"`
        }
    });
}
