import type { LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Fetch all locations with basic details
    const { results: locations } = await db.prepare(`
        SELECT 
            id, name, description, photographer, 
            difficulty_rating, quality_score, 
            lat, lng, created_at, is_default_simulation
        FROM locations
        ORDER BY created_at DESC
    `).all<any>();

    // Fetch play counts per location
    const { results: playStats } = await db.prepare(`
        SELECT location_id, COUNT(id) as play_count 
        FROM game_sessions 
        GROUP BY location_id
    `).all<any>();

    const playCountMap = new Map(playStats.map(stat => [stat.location_id, stat.play_count]));

    // Generate CSV Header
    let csvString = "ID,Name,Description,Photographer,Difficulty Rating,Quality Score,Latitude,Longitude,Created At,Is Default Simulation,Total Times Played\n";

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
    locations.forEach(loc => {
        const playCount = playCountMap.get(loc.id) || 0;
        const row = [
            loc.id,
            loc.name,
            loc.description,
            loc.photographer,
            loc.difficulty_rating,
            loc.quality_score,
            loc.lat,
            loc.lng,
            loc.created_at,
            loc.is_default_simulation,
            playCount
        ].map(escapeCsv).join(",");
        
        csvString += row + "\n";
    });

    return new Response(csvString, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="geohunter_locations_${new Date().toISOString().split('T')[0]}.csv"`
        }
    });
}
