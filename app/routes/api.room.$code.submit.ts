import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
// Inline helper for now just in case
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function action({ request, params, context }: ActionFunctionArgs) {
    const userId = await requireUser(request);
    const code = params.code;
    const formData = await request.formData();
    const lat = parseFloat(formData.get("lat") as string);
    const lng = parseFloat(formData.get("lng") as string);

    if (isNaN(lat) || isNaN(lng)) {
        return Response.json({ error: "Invalid Coordinates" }, { status: 400 });
    }

    // We need locationId to verify against current round, 
    // BUT safest is to look up current round location from DB to prevent cheating

    try {
        const env = context.cloudflare.env as any;
        const db = env.DB as D1Database;

        const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
        if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
        if (room.status !== 'PLAYING') {
            return Response.json({ error: "Round not active" }, { status: 400 });
        }

        // Get Current Location
        const item = await db.prepare(
            "SELECT location_id FROM map_set_items WHERE set_id = ? AND order_index = ?"
        ).bind(room.map_set_id, room.current_index).first<any>();

        if (!item) {
            console.error(`Map Item not found for Set ${room.map_set_id} Index ${room.current_index}`);
            return Response.json({ error: "Location data missing for this round" }, { status: 500 });
        }

        const trueLoc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(item.location_id).first<any>();

        if (!trueLoc) {
            return Response.json({ error: "Target location not found in database" }, { status: 500 });
        }

        // Determine Score
        // 5000 pts max for distance. 
        // Quadratic Curve: 5000 * (1 - d/7000)^2, clamped at 0
        const distance = getDistance(lat, lng, trueLoc.lat, trueLoc.lng);
        const MAX_DISTANCE_SCORE = 5000;
        const MAX_DISTANCE_METERS = 7000; // 7km cutoff

        let distanceScore = 0;
        if (distance * 1000 < MAX_DISTANCE_METERS) { // distance is km
            distanceScore = Math.round(MAX_DISTANCE_SCORE * Math.pow(1 - (distance * 1000) / MAX_DISTANCE_METERS, 2));
        }

        // --- EVIDENCE VERIFICATION (Geometry Only - No Gemini for Speed) ---
        // Fetch Admin Evidence (Official Intel)
        const adminEvidenceResult = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ? AND created_by_user_id IS NULL").bind(trueLoc.id).all<any>();
        const adminEvidence = adminEvidenceResult.results || [];

        const adminBoxes = adminEvidence.map((ae: any) => ({
            id: ae.id,
            box: typeof ae.bounding_box === 'string' ? JSON.parse(ae.bounding_box) : ae.bounding_box,
            description: ae.description
        }));

        // Parse Student Evidence
        const evidenceListJson = formData.get("evidenceList") as string;
        let userEvidenceList = [];
        try {
            userEvidenceList = evidenceListJson ? JSON.parse(evidenceListJson) : [];
        } catch (e) {
            console.warn("Failed to parse evidence list", e);
        }

        let evidenceScore = 0;
        let matchedEvidenceIds: string[] = [];
        const fullFeedback = { results: [] as any[] };

        // Run Intersection Over Union (IoU) Matching
        userEvidenceList.forEach((userItem: any, index: number) => {
            const userBox = userItem.box;
            let bestMatchId = null;
            let maxIoU = 0;

            for (const adminEv of adminBoxes) {
                const adminBox = adminEv.box;
                if (!userBox || !adminBox) continue;

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

                if (iou > 0.3 && iou > maxIoU) {
                    maxIoU = iou;
                    bestMatchId = adminEv.id;
                }
            }

            if (bestMatchId) {
                if (!matchedEvidenceIds.includes(bestMatchId)) {
                    evidenceScore += 1000;
                    matchedEvidenceIds.push(bestMatchId);
                }
                fullFeedback.results.push({
                    index,
                    validity: 1.0,
                    description: adminBoxes.find(a => a.id === bestMatchId)?.description || "Evidence Match",
                    explanation: "You successfully identified a key detail."
                });
            }
        });

        const finalScore = distanceScore + evidenceScore;

        // Save Guess
        await db.prepare(
            "INSERT INTO room_guesses (room_code, location_id, user_id, lat, lng, score, distance, timestamp, evidence_found) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(code, trueLoc.id, userId, lat, lng, finalScore, distance, Date.now(), JSON.stringify(matchedEvidenceIds)).run();

        // Update Participant Totals
        await db.prepare(
            "UPDATE room_participants SET score = score + ? WHERE room_code = ? AND user_id = ?"
        ).bind(finalScore, code, userId).run();

        return Response.json({
            success: true,
            score: finalScore,
            points: finalScore, // Backward compat
            distance: distance * 1000, // Return meters for consistency with Game UI
            distanceScore,
            evidenceScore,
            matchedEvidenceIds,
            adminEvidence: adminBoxes,
            fullFeedback
        });

    } catch (error) {
        console.error("SUBMIT ERROR:", error);
        // Return a 200 with error field so UI doesn't crash entirely? No, 500 is correct for server error, but we need details.
        return Response.json({ error: "Internal Server Error", details: (error as any).message }, { status: 500 });
    }
}
