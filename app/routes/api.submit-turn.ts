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

    // 4. Dynamic Difficulty Adjustment
    let newDiff = currentDiff;
    if (score > 4500 && currentDiff < 5) {
        newDiff++;
    } else if (score < 1000 && currentDiff > 5) {
        newDiff--;
    }

    // 5. Update DB (Batch)
    const sessionId = crypto.randomUUID();
    const statements = [
        db.prepare("UPDATE locations SET difficulty_rating = ? WHERE id = ?").bind(newDiff, locationId),
        db.prepare(
            "INSERT INTO game_sessions (id, user_id, location_id, guess_lat, guess_lng, score, ai_feedback) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(sessionId, userId || null, locationId, userLat, userLng, score, JSON.stringify(aiFeedback))
    ];

    if (userId) {
        statements.push(
            db.prepare("UPDATE users SET total_games = total_games + 1, current_elo = current_elo + ? WHERE id = ?")
                .bind(Math.round(score / 10), userId)
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
