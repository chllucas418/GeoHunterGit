import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { checkEvidenceListWithGemini } from "~/lib/gemini.server";

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

    try {
        const env = context.cloudflare.env as any;
        const db = env.DB as D1Database;
        const GEMINI_API_KEY = env.GEMINI_API_KEY;

        const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
        if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
        if (room.status !== 'PLAYING') {
            return Response.json({ error: "Round not active" }, { status: 400 });
        }

        // Get Current Location
        const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;
        let targetLocationId: string;

        if (isGuidedRound) {
            const defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
            if (!defaultSim) return Response.json({ error: "Tutorial location not found" }, { status: 404 });
            targetLocationId = defaultSim.id;
        } else {
            const datasetIndex = room.has_guided_playthrough && room.current_index > 0 ? room.current_index - 1 : room.current_index;
            const item = await db.prepare(
                "SELECT location_id FROM map_set_items WHERE set_id = ? ORDER BY order_index ASC LIMIT 1 OFFSET ?"
            ).bind(room.map_set_id, datasetIndex).first<any>();

            if (!item) {
                console.error(`Map Item not found for Set ${room.map_set_id} Offset ${datasetIndex}`);
                return Response.json({ error: "Location data missing for this round" }, { status: 400 });
            }
            targetLocationId = item.location_id;
        }

        const trueLoc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(targetLocationId).first<any>();

        if (!trueLoc) {
            return Response.json({ error: "Target location not found in database" }, { status: 500 });
        }

        // Determine Score (Total 8000 Max = 5000 Dist + 2000 Evidence + 1000 Time)

        // 1. Distance Score: Stricter Curved Scale for Tuen Mun area
        const MAX_DISTANCE_SCORE = 5000;
        const distance = getDistance(lat, lng, trueLoc.lat, trueLoc.lng);
        const distanceMeters = distance * 1000;

        let distanceScore = 0;
        if (distanceMeters <= 100) {
            // Highly rewarded proximity: max 5000 down to 4500 at 100m
            distanceScore = Math.round(MAX_DISTANCE_SCORE - (distanceMeters * 5));
        } else if (distanceMeters <= 300) {
            // Dropoff from 100m to 300m
            distanceScore = Math.round(4500 - ((distanceMeters - 100) * 7.5));
        } else if (distanceMeters < 3000) {
            // Tail trailing down to 0 at 3km
            const fraction = (3000 - distanceMeters) / 2700;
            distanceScore = Math.round(3000 * Math.pow(fraction, 2));
        } else {
            // Out of bounds / Guessed Wrong
            distanceScore = 0;
        }

        // 2. Time Score: Speed Bonus
        // Max 1000 pts. Decays over 60 seconds (or Round Duration).
        // If undefined duration, assume 120s max.
        // Bonus = 1000 * (1 - elapsed/120)
        let timeScore = 0;
        if (room.round_start_time) {
            const elapsedSeconds = (Date.now() - room.round_start_time) / 1000;
            const TIME_LIMIT = 120; // Default 2 mins for bonus decay
            if (elapsedSeconds < TIME_LIMIT) {
                timeScore = Math.round(1000 * (1 - elapsedSeconds / TIME_LIMIT));
            }
        }

        // --- STEP 2: IMMEDIATE AI ANALYSIS & SCORING ---
        // (As requested: Calculate NOW, Store in DB, Reveal Later)
        // --- EVIDENCE VERIFICATION (Hybrid: AI + Geometry) ---
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
        let aiBonus = 0;
        let matchedEvidenceIds: string[] = [];
        let aiFeedback: any = { status: "processing" };

        // Run Gemini Analysis
        try {
            const GEMINI_BASE_URL = context.cloudflare.env.GEMINI_BASE_URL;
            const GEMINI_GATEWAY_TOKEN = context.cloudflare.env.GEMINI_GATEWAY_TOKEN;

            const fullFeedback = await checkEvidenceListWithGemini(
                GEMINI_API_KEY,
                trueLoc.image_url,
                userEvidenceList,
                trueLoc.name,
                adminBoxes,
                GEMINI_BASE_URL,
                GEMINI_GATEWAY_TOKEN
            );

            aiFeedback = fullFeedback;

            if (fullFeedback.results) {
                for (const item of fullFeedback.results) {
                    const userBox = userEvidenceList[item.index]?.box;
                    if (!userBox) continue;

                    let matchedAdminId = null;

                    // 1. Check if AI explicitly linked it
                    if (typeof item.matched_admin_index === 'number' && item.matched_admin_index >= 0) {
                        const matchedAdmin = adminBoxes[item.matched_admin_index];
                        if (matchedAdmin) {
                            matchedAdminId = matchedAdmin.id;
                        }
                    }

                    // 2. Fallback to geometry
                    if (!matchedAdminId) {
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

                            // Center distance fallback
                            const userCx = userBox.x + userBox.w / 2;
                            const userCy = userBox.y + userBox.h / 2;
                            const adminCx = adminBox.x + adminBox.w / 2;
                            const adminCy = adminBox.y + adminBox.h / 2;
                            const dist = Math.sqrt(Math.pow(userCx - adminCx, 2) + Math.pow(userCy - adminCy, 2));

                            if (iou > 0.3 || dist < 50) {
                                matchedAdminId = adminEv.id;
                                break;
                            }
                        }
                    }

                    // Scoring
                    // Scoring
                    if (item.validity > 0.7) {
                        // AI Confirmed
                        if (matchedAdminId) {
                            if (!matchedEvidenceIds.includes(matchedAdminId)) {
                                evidenceScore += 1000;
                                matchedEvidenceIds.push(matchedAdminId);
                            }
                        } else {
                            // Novel Discovery
                            aiBonus += 250;
                        }
                    } else if (matchedAdminId) {
                        // Geometry Match Only (Gemini missed it, but box overlaps)
                        // We must add this to results so it shows in UI
                        if (!matchedEvidenceIds.includes(matchedAdminId)) {
                            evidenceScore += 1000;
                            matchedEvidenceIds.push(matchedAdminId);

                            const adminItem = adminBoxes.find(a => a.id === matchedAdminId);
                            if (adminItem) {
                                // Inject into feedback
                                if (!aiFeedback.results) aiFeedback.results = [];
                                aiFeedback.results.push({
                                    index: item.index,
                                    description: adminItem.description,
                                    explanation: "Visual confirmation via scanner alignment.",
                                    validity: 1.0
                                });
                            }
                        }
                    }

                }
            }
        } catch (e) {
            console.error("Gemini Error:", e);
            aiFeedback = { error: "AI verification failed", results: [] };
        }

        // Cap Evidence Score to prevent overflow?
        // Let's say max 5 evidence items = 5000pts.

        evidenceScore += aiBonus; // Combine bonus into evidence score for simplicity

        // Total Score
        let finalScore = distanceScore + evidenceScore + timeScore;

        // Guided Playthrough: Don't count marks for the tutorial round
        if (isGuidedRound) {
            finalScore = 0;
            distanceScore = 0;
            evidenceScore = 0;
            timeScore = 0;
        }

        // Tuen Mun Elo Update Calculation
        let eloChange = 0;
        if (!isGuidedRound) {
            if (distanceMeters <= 500) {
                eloChange = Math.round(20 + (500 - distanceMeters) / 25);
            } else if (distanceMeters <= 1500) {
                eloChange = Math.round(5 - (distanceMeters - 500) / 100);
            } else {
                eloChange = Math.round(-15 - (distanceMeters - 1500) / 100);
            }
            eloChange = Math.max(-40, Math.min(40, eloChange));
        }

        // Save Guess (Update: Added distance_score and evidence_score columns)
        await db.prepare(
            "INSERT INTO room_guesses (room_code, location_id, user_id, lat, lng, score, distance, timestamp, evidence_found, ai_feedback, distance_score, evidence_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(code, trueLoc.id, userId, lat, lng, finalScore, distance, Date.now(), JSON.stringify(matchedEvidenceIds), JSON.stringify(aiFeedback), distanceScore, evidenceScore).run();

        // Update Participant Totals (skip for guided round)
        if (!isGuidedRound) {
            await db.prepare(
                "UPDATE room_participants SET score = score + ? WHERE room_code = ? AND user_id = ?"
            ).bind(finalScore, code, userId).run();
        }

        // Update User Elo & Accuracies (skip for guided round)
        if (!isGuidedRound && eloChange !== 0) {
            await db.prepare(
                "UPDATE users SET current_elo = MAX(0, current_elo + ?) WHERE id = ?"
            ).bind(eloChange, userId).run();
        }

        // RETURN SUCCESS BUT NO DATA to prevent client from showing result immediately
        return Response.json({
            success: true,
            message: "Submission Received. Determining Analysis...",
            // Do NOT return score/distance/feedback here.
            // Client should show "Waiting for Teacher" state.
            // Step 3: Don't show result yet.
        });

    } catch (error) {
        console.error("SUBMIT ERROR:", error);
        return Response.json({ error: "Internal Server Error", details: (error as any).message }, { status: 500 });
    }
}
