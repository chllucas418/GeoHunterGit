import type { ActionFunctionArgs } from 'react-router';
import { analyzeImageQuality } from '~/lib/gemini.server';

// Server-side Action for Mass Add
export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const intent = formData.get('intent');
    const env = context.cloudflare.env as any;

    // 1. AI Analysis
    if (intent === 'analyze') {
        const dataUri = formData.get('image_data') as string;
        if (!dataUri) return Response.json({ error: "No image data provided" }, { status: 400 });

        try {
            const aiData = await analyzeImageQuality(
                dataUri,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                undefined
            );
            return Response.json({ success: true, aiData });
        } catch (e: any) {
            console.error("AI Error:", e);
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    // 2. Final Save
    if (intent === 'save') {
        const db = env.DB as D1Database;
        const bucket = env.ASSETS_BUCKET as R2Bucket;

        const file = formData.get('image') as File;
        const metadataStr = formData.get('metadata') as string;
        const metadata = JSON.parse(metadataStr);

        // Upload to R2
        const key = `locations/${crypto.randomUUID()}.jpg`;
        await bucket.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });
        const publicUrl = `https://assets.hkgeohunter.com/${key}`;

        // Save to D1
        const locationId = `loc_${Math.random().toString(36).substring(2, 9)}`;

        await db.prepare(`
            INSERT INTO locations (
                id, name, description, difficulty_rating, hints, 
                lat, lng, image_url, 
                photographer, quality_score, map_evidence, verified_by_gemini
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(
            locationId,
            metadata.locationName || "New Location",
            metadata.description,
            metadata.difficulty,
            JSON.stringify(metadata.hints),
            metadata.lat,
            metadata.lng,
            publicUrl,
            metadata.photographer,
            metadata.quality_score || 80,
            JSON.stringify(metadata.evidence || [])
        ).run();

        // Add to Dataset if selected
        if (metadata.addToSet) {
            // Check if already in set (unlikely for new loc but good practice)
            const exists = await db.prepare("SELECT 1 FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(metadata.addToSet, locationId).first();
            if (!exists) {
                const max = await db.prepare("SELECT MAX(order_index) as m FROM map_set_items WHERE set_id = ?").bind(metadata.addToSet).first<any>();
                const nextOrder = (max?.m || 0) + 1;
                await db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)").bind(metadata.addToSet, locationId, nextOrder).run();
            }
        }

        return Response.json({ success: true, savedId: key });
    }

    return null;
}
