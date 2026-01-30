import type { ActionFunctionArgs } from "react-router";
import { checkEvidenceWithGemini } from "~/lib/gemini.server";
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
    const boxJson = formData.get("box") as string; // JSON string or null

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const GEMINI_API_KEY = env.GEMINI_API_KEY;

    // 1. Fetch Location Data
    const loc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(locationId).first<any>();
    if (!loc) {
        return Response.json({ error: "Location not found" }, { status: 404 });
    }

    const actualLat = loc.lat;
    const actualLng = loc.lng;
    const imageUrl = loc.image_url;
    const currentDiff = loc.difficulty_rating || 5;

    // 2. Calculate Score (Exponential Decay for HK-scale)
    const distance = calculateDistance(userLat, userLng, actualLat, actualLng);
    // 5000 * e^(-distance/2000) -> 2km error is ~1840 points
    let score = Math.round(5000 * Math.exp(-distance / 2000));

    // 3. AI Verification
    let aiBonus = 0;
    let aiFeedback = null;

    if (boxJson) {
        const box = JSON.parse(boxJson);
        try {
            const verification = await checkEvidenceWithGemini(
                GEMINI_API_KEY,
                imageUrl,
                box,
                "Hong Kong"
            );

            aiFeedback = verification;
            if (verification.validity > 0.7) {
                aiBonus = 1000;
                score += aiBonus;
            }
        } catch (e) {
            console.error("Gemini Error:", e);
            aiFeedback = { error: "AI verification failed" };
        }
    }

    // 4. Dynamic Difficulty Adjustment (Non-linear Curve)
    // Baseline score is 2500. Deviations from this adjust the difficulty rating.
    // The curve uses a power of 1.5 to be more sensitive to significant outliers.
    const scoreDiff = (2500 - score) / 2500; // -1.0 (perfect) to 1.0 (total miss)
    const curveAdjustment = Math.sign(scoreDiff) * Math.pow(Math.abs(scoreDiff), 1.5) * 0.3;

    let newDiff = Math.max(1, Math.min(10, currentDiff + curveAdjustment));

    // 5. Update DB (Batch)
    const sessionId = crypto.randomUUID();

    // Check if user is a real user in the DB to avoid FK errors
    let validUserId = null;
    if (userId && userId !== "developer-admin") {
        const userExists = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
        if (userExists) {
            validUserId = userId;
        }
    }

    const statements = [
        db.prepare("UPDATE locations SET difficulty_rating = ? WHERE id = ?").bind(newDiff, locationId),
        db.prepare(
            "INSERT INTO game_sessions (id, user_id, location_id, guess_lat, guess_lng, score, ai_feedback) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(sessionId, validUserId, locationId, userLat, userLng, score, JSON.stringify(aiFeedback))
    ];

    if (validUserId) {
        const eloChange = Math.round((score - 2000) / 10);
        const accuracyForTurn = Math.min(1.0, score / 5000);

        statements.push(
            db.prepare(`
                UPDATE users 
                SET 
                    accuracy_avg = (accuracy_avg * total_games + ?) / (total_games + 1),
                    current_elo = current_elo + ?,
                    total_games = total_games + 1
                WHERE id = ?
            `).bind(accuracyForTurn, eloChange, validUserId)
        );
    }

    try {
        await db.batch(statements);
    } catch (e) {
        console.error("D1 Update Error:", e);
    }

    return Response.json({
        score,
        distance,
        aiFeedback,
        newDifficulty: newDiff,
        message: "Turn processed"
    });
}
