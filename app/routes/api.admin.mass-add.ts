import type { ActionFunctionArgs } from 'react-router';
import { analyzeImageQuality, chatWithGemini, classifyBatchImages, findRealLocationPhoto, batchAnalyzeOfficialEvidence } from '~/lib/gemini.server';

// Server-side Action for Mass Add
export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const intent = formData.get('intent');
    const env = context.cloudflare.env as any;

    // 0. Draft Management
    if (intent === 'upload_temp') {
        try {
            const file = formData.get('image') as File;
            if (!file) return Response.json({ error: "No image file in upload_temp" }, { status: 400 });
            
            const bucket = env.ASSETS_BUCKET as R2Bucket;
            const key = `temp_drafts/${crypto.randomUUID()}.jpg`;
            console.log(`[MassAdd API] Uploading temp image: ${key} (${file.size} bytes)`);
            
            await bucket.put(key, await file.arrayBuffer(), {
                httpMetadata: { contentType: file.type }
            });
            const publicUrl = `https://assets.hkgeohunter.com/${key}`;
            return Response.json({ success: true, url: publicUrl });
        } catch (e: any) {
            console.error("[MassAdd API] upload_temp failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'save_draft') {
        try {
            const draftData = formData.get('draft_data') as string;
            if (!draftData) return Response.json({ error: "No draft data provided" }, { status: 400 });
            
            const db = env.DB as D1Database;
            console.log(`[MassAdd API] Saving global draft (${draftData.length} chars)`);
            
            await db.prepare("INSERT INTO mass_add_drafts (id, draft_data, updated_at) VALUES ('global', ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET draft_data = EXCLUDED.draft_data, updated_at = CURRENT_TIMESTAMP")
                .bind(draftData).run();
            
            return Response.json({ success: true });
        } catch (e: any) {
            console.error("[MassAdd API] save_draft failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'load_draft') {
        try {
            const db = env.DB as D1Database;
            const draft = await db.prepare("SELECT draft_data FROM mass_add_drafts WHERE id = 'global'").first<any>();
            console.log("[MassAdd API] Loading global draft:", draft ? "Found" : "Empty");
            return Response.json({ success: true, draft: draft ? JSON.parse(draft.draft_data) : null });
        } catch (e: any) {
            console.error("[MassAdd API] load_draft failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'clear_draft') {
        try {
            const db = env.DB as D1Database;
            console.log("[MassAdd API] Clearing global draft");
            await db.prepare("DELETE FROM mass_add_drafts WHERE id = 'global'").run();
            return Response.json({ success: true });
        } catch (e: any) {
            console.error("[MassAdd API] clear_draft failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'classify_batch') {
        try {
            const imagesJson = formData.get('images') as string;
            const images = JSON.parse(imagesJson) as { mimeType: string; data: string }[];
            
            console.log(`[MassAdd API] Classifying batch of ${images.length} images`);
            const validIndices = await classifyBatchImages(
                images,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY
            );
            
            return Response.json({ success: true, validIndices });
        } catch (e: any) {
            console.error("[MassAdd API] classify_batch failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'filter_target_image') {
        try {
            const imagesJson = formData.get('images') as string;
            const images = JSON.parse(imagesJson) as { mimeType: string; data: string }[];
            
            console.log(`[MassAdd API] Filtering target photo from batch of ${images.length} candidate images`);
            const { best_index, confidence } = await findRealLocationPhoto(
                images,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY
            );
            
            return Response.json({ success: true, bestIndex: best_index, confidence });
        } catch (e: any) {
            console.error("[MassAdd API] filter_target_image failed:", e);
            return Response.json({ success: false, error: e.message }, { status: 500 });
        }
    }

    if (intent === 'proxy_image') {
        try {
            const imageUrl = formData.get('url') as string;
            if (!imageUrl) throw new Error("No URL provided");
            
            // Validate the URL is from our trusted asset domain
            if (!imageUrl.includes('assets.hkgeohunter.com')) {
                return Response.json({ error: "Unauthorized domain" }, { status: 403 });
            }

            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error("Failed to fetch target image");

            const mimeType = response.headers.get("content-type") || "image/jpeg";
            const buffer = await response.arrayBuffer();

            return new Response(buffer, {
                headers: {
                    "Content-Type": mimeType,
                    "Access-Control-Allow-Origin": "*", // Allow cross-origin for the blob build
                    "Cache-Control": "public, max-age=3600"
                }
            });
        } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    // 1. AI Analysis
    if (intent === 'analyze') {
        const dataUri = formData.get('image_data') as string;
        const imageUrl = formData.get('image_url') as string;
        const latStr = formData.get('lat') as string;
        const lngStr = formData.get('lng') as string;
        const evidenceStr = formData.get('evidence') as string;
        
        let contextParam: any = {};
        if (latStr && lngStr) {
            contextParam.lat = parseFloat(latStr);
            contextParam.lng = parseFloat(lngStr);
        }
        if (evidenceStr) {
            try {
                contextParam.evidenceList = JSON.parse(evidenceStr);
            } catch (e) {}
        }
        
        if (!dataUri && !imageUrl) return Response.json({ error: "No image data or URL provided" }, { status: 400 });

        try {
            const aiData = await analyzeImageQuality(
                imageUrl || dataUri,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY || "",
                contextParam
            );
            return Response.json({ success: true, aiData });
        } catch (e: any) {
            console.error("AI Error:", e);
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    if (intent === 'chat') {
        const message = formData.get('message') as string;
        const historyStr = formData.get('history') as string;
        const dataUri = formData.get('image_data') as string;
        const imageUrl = formData.get('image_url') as string;
        const latStr = formData.get('lat') as string;
        const lngStr = formData.get('lng') as string;
        const evidenceStr = formData.get('evidence') as string;
        const currentDescription = formData.get('current_description') as string;
        const currentHintsStr = formData.get('current_hints') as string;
        let currentState = undefined;
        if (currentDescription || currentHintsStr) {
            try {
                currentState = {
                    description: currentDescription,
                    hints: currentHintsStr ? JSON.parse(currentHintsStr) : []
                };
            } catch (e) {}
        }

        let history = [];
        try { if (historyStr) history = JSON.parse(historyStr); } catch (e) {}
        
        let evidenceList = [];
        try { if (evidenceStr) evidenceList = JSON.parse(evidenceStr); } catch (e) {}
        
        let locationData = null;
        if (latStr && lngStr) {
            locationData = { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
        }

        try {
            const aiResponse = await chatWithGemini(
                "gemini-3.5-flash", // modelName (Using 3.5 Flash)
                message,
                history,
                imageUrl || "", // Pass imageUrl if provided
                locationData,
                evidenceList,
                env.GEMINI_BASE_URL,
                env.GEMINI_GATEWAY_TOKEN,
                env.GEMINI_API_KEY || "",
                dataUri, // Pass dataUri if provided
                currentState
            );
            console.log("[MassAdd API] AI Chat response length:", aiResponse.length);
            if (aiResponse.includes("```json")) {
                console.log("[MassAdd API] AI response contains JSON blocks");
            }
            return Response.json({ success: true, ai_response: aiResponse });
        } catch (e: any) {
            console.error("AI Chat Error:", e);
            return Response.json({ error: e.message }, { status: 500 });
        }
    }

    // 2. Final Save
    if (intent === 'save') {
        console.log("[MassAdd API] Save initiated");
        const db = env.DB as D1Database;
        const bucket = env.ASSETS_BUCKET as R2Bucket;

        try {
            const file = formData.get('image') as File;
            const metadataStr = formData.get('metadata') as string;
            
            if (!metadataStr) throw new Error("No metadata found in request");
            const metadata = JSON.parse(metadataStr);

            if (!file && (!metadata.preview || !metadata.preview.startsWith('http'))) {
                 throw new Error("No image file found in request and no valid preview URL available");
            }
            console.log("[MassAdd API] Metadata parsed:", { ...metadata, hints: metadata.hints?.length });

            let publicUrl = "";
            if (file && file.size > 0) {
                // Upload to R2
                const key = `locations/${crypto.randomUUID()}.jpg`;
                console.log("[MassAdd API] Uploading to R2:", key);
                await bucket.put(key, await file.arrayBuffer(), {
                    httpMetadata: { contentType: file.type }
                });
                publicUrl = `https://assets.hkgeohunter.com/${key}`;
            } else if (metadata.preview && metadata.preview.startsWith('https://assets.hkgeohunter.com/temp_drafts/')) {
                // Reuse the temporary URL
                publicUrl = metadata.preview;
                console.log("[MassAdd API] Reusing temporary R2 URL:", publicUrl);
            } else {
                throw new Error("No valid image file or pre-cached image URL found");
            }

            // Save to D1
            const locationId = `loc_${Math.random().toString(36).substring(2, 9)}`;
            console.log("[MassAdd API] Inserting into D1 locations:", locationId);

            await db.prepare(`
                INSERT INTO locations (
                    id, name, description, difficulty_rating, hints, 
                    lat, lng, image_url, 
                    photographer, quality_score, map_evidence, verified_by_gemini
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                JSON.stringify(metadata.evidence || []),
                1 // verified_by_gemini
            ).run();

            // [FIX] Also insert into the map_evidence table so the game logic can find it!
            if (metadata.evidence && metadata.evidence.length > 0) {
                console.log("[MassAdd API] Inserting evidence items:", metadata.evidence.length);

                // Generate actual AI analyses for each official evidence item
                let analyses: any[] = [];
                try {
                    console.log("[MassAdd API] Generating AI analyses for evidence...", publicUrl);
                    analyses = await batchAnalyzeOfficialEvidence(
                        publicUrl,
                        metadata.evidence.map((ev: any, idx: number) => ({
                            id: String(idx),
                            box: ev.box,
                            description: ev.description
                        })),
                        env.GEMINI_BASE_URL,
                        env.GEMINI_GATEWAY_TOKEN,
                        env.GEMINI_API_KEY
                    );
                } catch (e) {
                    console.error("[MassAdd API] Failed to generate AI analysis:", e);
                }

                const stmt = db.prepare("INSERT INTO map_evidence (id, location_id, bounding_box, description, is_verified, ai_analysis) VALUES (?, ?, ?, ?, 1, ?)");
                const batch = metadata.evidence.map((ev: any, idx: number) => {
                    const matchedAnalysis = analyses.find((a: any) => a.id === String(idx));
                    const aiText = matchedAnalysis?.ai_analysis || `Factual target landmark: ${ev.description}. Key geographic identifier in this sector.`;
                    return stmt.bind(
                        `ev_${Math.random().toString(36).substring(2, 9)}`,
                        locationId,
                        JSON.stringify(ev.box),
                        ev.description,
                        aiText
                    );
                });
                await db.batch(batch);
            }

            // Add to Dataset if selected
            if (metadata.addToSet) {
                console.log("[MassAdd API] Adding to set:", metadata.addToSet);
                const exists = await db.prepare("SELECT 1 FROM map_set_items WHERE set_id = ? AND location_id = ?").bind(metadata.addToSet, locationId).first();
                if (!exists) {
                    const max = await db.prepare("SELECT MAX(order_index) as m FROM map_set_items WHERE set_id = ?").bind(metadata.addToSet).first<any>();
                    const nextOrder = (max?.m || 0) + 1;
                    await db.prepare("INSERT INTO map_set_items (set_id, location_id, order_index) VALUES (?, ?, ?)").bind(metadata.addToSet, locationId, nextOrder).run();
                }
            }

            console.log("[MassAdd API] Save successful");
            return Response.json({ success: true, savedId: publicUrl });
        } catch (e: any) {
            console.error("[MassAdd API] Save Critical Error:", e);
            // Return error details to client for debugging
            return Response.json({ success: false, error: e.message, stack: e.stack }, { status: 500 });
        }
    }

    return null;
}
