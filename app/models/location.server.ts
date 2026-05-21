import type { D1Database } from "@cloudflare/workers-types";

export async function getDefaultSimulationLocation(db: D1Database) {
    let location = await db.prepare("SELECT * FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
    if (!location) {
        location = await db.prepare("SELECT * FROM locations ORDER BY created_at ASC LIMIT 1").first<any>();
    }
    return location;
}

export async function getLocationById(db: D1Database, id: string) {
    return db.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first<any>();
}

export async function getMapEvidenceByLocation(db: D1Database, locationId: string) {
    const result = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(locationId).all<any>();
    return result.results || [];
}

export async function getMapSetItemsCount(db: D1Database, setId: string) {
    const result = await db.prepare("SELECT COUNT(*) as count FROM map_set_items WHERE set_id = ?").bind(setId).first<{ count: number }>();
    return result?.count || 0;
}

export async function getMapSetItemByIndex(db: D1Database, setId: string, index: number) {
    return db.prepare(
        "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
    ).bind(setId, index).first<any>();
}
