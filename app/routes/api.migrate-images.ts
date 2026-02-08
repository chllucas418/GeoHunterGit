import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const bucket = env.ASSETS_BUCKET as R2Bucket;

    // Fetch all locations
    const locations = await db.prepare("SELECT id, image_url FROM locations").all<any>();

    if (!locations.results || locations.results.length === 0) {
        return Response.json({ message: "No locations found to migrate." });
    }

    const migrated = [];
    const errors = [];
    const skipped = [];

    for (const loc of locations.results) {
        // Check if image is base64
        if (loc.image_url && loc.image_url.startsWith("data:")) {
            try {
                // Extract base64 data
                const matches = loc.image_url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const contentType = matches[1];
                    const buffer = Uint8Array.from(atob(matches[2]), c => c.charCodeAt(0));

                    const key = `locations/${loc.id}.jpg`;

                    // Upload to R2
                    await bucket.put(key, buffer, {
                        httpMetadata: { contentType: contentType }
                    });

                    const publicUrl = `https://assets.hkgeohunter.com/${key}`;

                    // Update Database
                    await db.prepare("UPDATE locations SET image_url = ? WHERE id = ?")
                        .bind(publicUrl, loc.id)
                        .run();

                    migrated.push(loc.id);
                } else {
                    errors.push({ id: loc.id, error: "Invalid base64 format" });
                }
            } catch (e: any) {
                errors.push({ id: loc.id, error: e.message });
            }
        } else {
            skipped.push(loc.id); // Already a URL or empty
        }
    }

    return Response.json({
        total: locations.results.length,
        migrated: migrated.length,
        skipped: skipped.length,
        errors: errors.length,
        migratedIds: migrated,
        errorDetails: errors
    });
}
