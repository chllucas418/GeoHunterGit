import type { ActionFunctionArgs } from "react-router";
import { checkEvidenceListWithGemini } from "~/lib/gemini.server";
import { getUserId } from "~/lib/auth.server";

// Haversine Formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

export async function action({ request, context }: ActionFunctionArgs) {
    const userId = await getUserId(request);
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const locationId = formData.get("locationId") as string;
    const userLat = parseFloat(formData.get("lat") as string);
    const userLng = parseFloat(formData.get("lng") as string);
    const evidenceListJson = formData.get("evidenceList") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const GEMINI_API_KEY = env.GEMINI_API_KEY;

    // 1. Fetch Location
    const loc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(locationId).first<any>();
    if (!loc) {
        return Response.json({ error: "Location not found" }, { status: 404 });
    }

    // 2. Calculate Distance Score
    const distance = calculateDistance(userLat, userLng, loc.lat, loc.lng);
    let score = Math.max(0, Math.round(5000 * (1 - distance / 20000)));

    // 3. Evidence Processing & AI Verification
    let aiBonus = 0;
    let aiFeedback: any = { status: "no_evidence_submitted" };

    if (evidenceListJson) {
        const evidenceList = JSON.parse(evidenceListJson);

        try {
            // Check against Gemini
            const verification = await checkEvidenceListWithGemini(
                GEMINI_API_KEY,
                loc.image_url,
                evidenceList,
                "Hong Kong"
            );

            aiFeedback = verification;

            // Score Calculation
            if (verification.results) {
                const validItems = verification.results.filter((r: any) => r.validity > 0.7);
                aiBonus = validItems.length * 500; // 500 points per valid clue
                score += aiBonus;

                // Auto-Add Novel Evidence to DB
                // Only if highly valid and marked as novel
                const novelItems = validItems.filter((r: any) => r.is_novel && r.validity > 0.85);

                if (novelItems.length > 0) {
                    const insertStmt = db.prepare("INSERT INTO map_evidence (id, location_id, bounding_box, description, is_verified, created_by_user_id) VALUES (?, ?, ?, ?, 1, ?)");
                    const batch = [];

                    for (const item of novelItems) {
                        const originalEvidence = evidenceList[item.index];
                        if (originalEvidence) {
                            batch.push(insertStmt.bind(
                                `ev_${Math.random().toString(36).substring(2, 9)}`,
                                locationId,
                                JSON.stringify(originalEvidence.box),
                                originalEvidence.description,
                                userId
                            ));
                        }
                    }
                    if (batch.length > 0) await db.batch(batch);
                }
            }
        } catch (e) {
            console.error("Gemini Error:", e);
            aiFeedback = { error: "AI verification failed" };
        }
    }

    // 4. Dynamic Difficulty Adjustment
    const baseScore = score - aiBonus;
    const scoreDiff = (2500 - baseScore) / 2500;
    const curveAdjustment = Math.sign(scoreDiff) * Math.pow(Math.abs(scoreDiff), 1.5) * 0.3;
    let newDiff = Math.max(1, Math.min(10, (loc.difficulty_rating || 5) + curveAdjustment));
    newDiff = parseFloat(newDiff.toFixed(2));

    // 5. Update DB
    const sessionId = crypto.randomUUID();
    let validUserId = null;
    if (userId && userId !== "developer-admin") {
        const userExists = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
        if (userExists) validUserId = userId;
    }

    const statements = [
        db.prepare("UPDATE locations SET difficulty_rating = ? WHERE id = ?").bind(newDiff, locationId),
        db.prepare(
            "INSERT INTO game_sessions (id, user_id, location_id, guess_lat, guess_lng, score, ai_feedback) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(sessionId, validUserId, locationId, userLat, userLng, score, JSON.stringify(aiFeedback))
    ];

    if (validUserId) {
        const eloChange = Math.round((score - 2000) / 10);
        const accuracyForTurn = Math.min(1.0, score / 5000); // Only count distance score for accuracy stat
        statements.push(
            db.prepare(`
                UPDATE users 
                SET accuracy_avg = (accuracy_avg * total_games + ?) / (total_games + 1),
                    current_elo = current_elo + ?,
                    total_games = total_games + 1
                WHERE id = ?
            `).bind(accuracyForTurn, eloChange, validUserId)
        );
    }

    try { await db.batch(statements); } catch (e) { console.error("D1 Update Error:", e); }

    return Response.json({
        score,
        distance,
        aiFeedback: aiFeedback?.explanation || "Evidence analyzed", // Simplify feedback for UI for now, or send full obj
        fullFeedback: aiFeedback, // Send full obj for detailed UI
        newDifficulty: newDiff,
        aiBonus
    });
}
