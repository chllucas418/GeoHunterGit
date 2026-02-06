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
    const MAX_DISTANCE_SCORE = 5000;
    const MAX_DISTANCE_METERS = 7000; // 7km cutoff

    // Quadratic Curve: 5000 * (1 - d/7000)^2, clamped at 0
    let distanceScore = 0;
    if (distance < MAX_DISTANCE_METERS) {
        distanceScore = Math.round(MAX_DISTANCE_SCORE * Math.pow(1 - distance / MAX_DISTANCE_METERS, 2));
    }

    // 3. Evidence Processing (Hybrid: Geometry Match + AI Validation)
    let aiBonus = 0;
    let evidenceScore = 0;
    let aiFeedback: any = { status: "processing" };
    const matchedEvidenceIds: string[] = [];

    // Fetch Admin Evidence
    const adminEvidence = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ? AND created_by_user_id IS NULL").bind(locationId).all<any>();
    const adminBoxes = adminEvidence.results.map((ae: any) => ({
        id: ae.id,
        box: JSON.parse(ae.bounding_box),
        description: ae.description
    }));

    // Always run AI analysis to get the "Teaching Moment" even if user found nothing
    const userEvidenceList = evidenceListJson ? JSON.parse(evidenceListJson) : [];

    try {
        // 5. AI Analysis (with Admin Context)
        const fullFeedback = await checkEvidenceListWithGemini(
            GEMINI_API_KEY,
            loc.image_url,
            userEvidenceList, // User's boxes (can be empty)
            loc.name,
            adminBoxes // Pass Admin Evidence for context
        );

        aiFeedback = fullFeedback;

        if (fullFeedback.results) {
            for (const item of fullFeedback.results) {
                // Safety check index
                const userBox = userEvidenceList[item.index]?.box;
                if (!userBox) continue;

                // B. Geometry Match (Fallback) or AI Match (Priority)
                let matchedAdminId = null;

                // 1. Check if AI explicitly linked it
                if (typeof item.matched_admin_index === 'number' && item.matched_admin_index >= 0) {
                    const matchedAdmin = adminBoxes[item.matched_admin_index];
                    if (matchedAdmin) {
                        matchedAdminId = matchedAdmin.id;
                    }
                }

                // 2. If AI didn't catch it, fallback to geometry (Advanced: Intersection Over Union + Center Distance)
                if (!matchedAdminId) {
                    for (const adminEv of adminBoxes) {
                        const userBox = userEvidenceList[item.index]?.box;
                        const adminBox = adminEv.box;

                        if (!userBox || !adminBox) continue;

                        // Calculate IoU (Intersection over Union)
                        const x1 = Math.max(userBox.x, adminBox.x);
                        const y1 = Math.max(userBox.y, adminBox.y);
                        const x2 = Math.min(userBox.x + userBox.w, adminBox.x + adminBox.w);
                        const y2 = Math.min(userBox.y + userBox.h, adminBox.y + adminBox.h);

                        const intersectionW = Math.max(0, x2 - x1);
                        const intersectionH = Math.max(0, y2 - y1);
                        const intersectionArea = intersectionW * intersectionH;

                        const userArea = userBox.w * userBox.h;
                        const adminArea = adminBox.w * adminBox.h;
                        const unionArea = userArea + adminArea - intersectionArea;

                        const iou = unionArea > 0 ? intersectionArea / unionArea : 0;

                        // Center distance fallback
                        const userCx = userBox.x + userBox.w / 2;
                        const userCy = userBox.y + userBox.h / 2;
                        const adminCx = adminBox.x + adminBox.w / 2;
                        const adminCy = adminBox.y + adminBox.h / 2;
                        const dist = Math.sqrt(Math.pow(userCx - adminCx, 2) + Math.pow(userCy - adminCy, 2));

                        // Thresholds: IoU > 0.3 (30% overlap) OR Center Closeness < 50 units (approx 3% of canvas)
                        // STRICTER: We want to avoid auto-accepting loose boxes.
                        if (iou > 0.3 || dist < 50) {
                            matchedAdminId = adminEv.id;
                            break;
                        }
                    }
                }

                // Scoring Logic
                if (item.validity > 0.7 || matchedAdminId) {
                    if (matchedAdminId) {
                        // User found a known clue!
                        // CHECK DEDUPLICATION: Only award if this admin ID hasn't been matched yet in this turn
                        if (!matchedEvidenceIds.includes(matchedAdminId)) {
                            evidenceScore += 1000;
                            matchedEvidenceIds.push(matchedAdminId);
                        }
                    } else {
                        // User found a NEW valid clue (AI confirmed but not in DB)
                        aiBonus += 250;
                    }
                }
            }
        }
    } catch (e) {
        console.error("Gemini Error:", e);
        aiFeedback = { error: "AI verification failed" };
    }

    // 4. Dynamic Difficulty Adjustment
    const finalScore = distanceScore + evidenceScore + aiBonus;

    const scoreDiff = (3000 - finalScore) / 3000; // Adjusted target score higher
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
        ).bind(sessionId, validUserId, locationId, userLat, userLng, finalScore, JSON.stringify(aiFeedback))
    ];

    if (validUserId) {
        const eloChange = Math.round((finalScore - 2000) / 10);
        const accuracyForTurn = Math.min(1.0, distanceScore / 5000); // Only count distance score for accuracy stat
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
        score: finalScore,
        distance,
        distanceScore, // Explicit return
        aiFeedback: aiFeedback?.explanation || "Evidence analyzed",
        fullFeedback: aiFeedback,
        newDifficulty: newDiff,
        aiBonus,
        evidenceScore,
        matchedEvidenceIds,
        adminEvidence: adminBoxes
    });
}
