import type { D1Database } from "@cloudflare/workers-types";

export async function getRoomByCode(db: D1Database, code: string) {
    return db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
}

export async function getRoomParticipants(db: D1Database, code: string) {
    const result = await db.prepare(`
        SELECT rp.*, u.display_name, u.profile_picture_url 
        FROM room_participants rp
        JOIN users u ON rp.user_id = u.id
        WHERE rp.room_code = ? 
        ORDER BY rp.score DESC
    `).bind(code).all<any>();
    return result.results || [];
}

export async function getRoomGuessRecord(db: D1Database, code: string, locationId: string, userId: string) {
    return db.prepare(
        "SELECT * FROM room_guesses WHERE room_code = ? AND location_id = ? AND user_id = ?"
    ).bind(code, locationId, userId).first<any>();
}

export async function getRoomGuessCount(db: D1Database, code: string, locationId: string) {
    const result = await db.prepare(
        "SELECT COUNT(*) as count FROM room_guesses WHERE room_code = ? AND location_id = ?"
    ).bind(code, locationId).first<{ count: number }>();
    return result?.count || 0;
}
