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
        // const GEMINI_API_KEY = env.GEMINI_API_KEY; // Removed for AI Gateway enforcement

        const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<any>();
        if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
        if (room.status !== 'PLAYING') {
            return Response.json({ error: "Round not active" }, { status: 400 });
        }

        // Get Current Location
        const isGuidedRound = room.current_index === 0 && room.has_guided_playthrough;
        let targetLocationId: string;

        if (isGuidedRound) {
            let defaultSim = await db.prepare("SELECT id FROM locations WHERE is_default_simulation = 1 LIMIT 1").first<any>();
            if (!defaultSim) {
                defaultSim = await db.prepare("SELECT id FROM locations ORDER BY created_at ASC LIMIT 1").first<any>();
            }
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

        // 1. Time & Multiplier Calculation
        const TIME_LIMIT = room.time_limit || 120;
        let elapsedSeconds = 0;
        if (room.round_start_time) {
            elapsedSeconds = Math.max(0, (Date.now() - room.round_start_time) / 1000);
        }
        
        // --- 100% Precision UI Sychronization ---
        // Accept the exact floating-point second the student locked in at from the client payload.
        // Anti-Cheat: Validate it against the server timestamp with a leniency buffer of 5 seconds for network latency/clock drift.
        const clientSubmittedAt = formData.get("submittedAtSeconds");
        if (clientSubmittedAt) {
            const parsedClient = parseFloat(clientSubmittedAt.toString());
            if (!isNaN(parsedClient) && parsedClient >= 0 && parsedClient <= elapsedSeconds + 5) {
                elapsedSeconds = parsedClient; // Use the client's perfect millisecond
            }
        }
        
        const scoreMultiplier = formData.get("scoreMultiplier") === "true";
        const isLeeched = formData.get("isLeeched") === "true";
        const hasMultiplierLeech = formData.get("hasMultiplierLeech") === "true";
        const hasChronoFreeze = formData.get("hasChronoFreeze") === "true";
        const hasIroncladLockdown = formData.get("hasIroncladLockdown") === "true";

        // Dynamic Scaling Formula (Matching Client EXACTLY to prevent divergence)
        const taMax = room.ta_max_multiplier ?? 2.0;
        const taMin = room.ta_min_multiplier ?? 0.5;
        const graceSec = room.ta_grace_period ?? 30;

        const START_GRACE = Math.min(graceSec, Math.floor(TIME_LIMIT * 0.25));
        const END_GRACE = Math.min(graceSec, Math.floor(TIME_LIMIT * 0.25));
        const DECAY_WINDOW = Math.max(1, TIME_LIMIT - START_GRACE - END_GRACE);

        let baseTimeMultiplier = taMax;

        if (hasIroncladLockdown) {
            baseTimeMultiplier = taMax;
        } else {
            let effectiveSeconds = elapsedSeconds;
            if (hasChronoFreeze) {
                effectiveSeconds = Math.max(0, elapsedSeconds - 15);
            }

            if (effectiveSeconds > START_GRACE) {
                if (effectiveSeconds >= TIME_LIMIT - END_GRACE) {
                    baseTimeMultiplier = taMin;
                } else {
                    const fraction = (effectiveSeconds - START_GRACE) / DECAY_WINDOW;
                    baseTimeMultiplier = taMax - ((taMax - taMin) * fraction);
                }
            }
        }

        if (isLeeched) {
            baseTimeMultiplier = Math.max(taMin, baseTimeMultiplier - 0.5);
        }
        if (hasMultiplierLeech) {
            baseTimeMultiplier = baseTimeMultiplier + 0.5;
        }

        let timeMultiplier = baseTimeMultiplier;
        if (scoreMultiplier) {
            timeMultiplier = baseTimeMultiplier * 1.5;
        }

        // 2. Distance Score: Stricter Curved Scale for Tuen Mun area
        const MAX_DISTANCE_SCORE = 5000;
        const distance = getDistance(lat, lng, trueLoc.lat, trueLoc.lng);
        const distanceMeters = distance * 1000;

        let baseDistanceScore = 0;
        if (distanceMeters <= 100) {
            baseDistanceScore = Math.round(MAX_DISTANCE_SCORE - (distanceMeters * 5));
        } else if (distanceMeters <= 300) {
            baseDistanceScore = Math.round(4500 - ((distanceMeters - 100) * 7.5));
        } else if (distanceMeters < 3000) {
            const fraction = (3000 - distanceMeters) / 2700;
            baseDistanceScore = Math.round(3000 * Math.pow(fraction, 2));
        } else {
            baseDistanceScore = 0;
        }

        let distanceScore = Math.round(baseDistanceScore * timeMultiplier);

        // 3. Independent Time Score (Bonus for speed)
        let timeScore = 0;
        if (elapsedSeconds < TIME_LIMIT) {
            timeScore = Math.round(1000 * (1 - elapsedSeconds / TIME_LIMIT));
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
            const GEMINI_API_KEY = context.cloudflare.env.GEMINI_API_KEY;

            const fullFeedback = await checkEvidenceListWithGemini(
                trueLoc.image_url,
                userEvidenceList,
                trueLoc.name,
                adminBoxes,
                GEMINI_BASE_URL,
                GEMINI_GATEWAY_TOKEN,
                GEMINI_API_KEY,
                undefined,
                trueLoc.lat,
                trueLoc.lng
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
                            const coverageOfAdmin = adminArea > 0 ? intersectionArea / adminArea : 0;

                            // Center distance fallback
                            const userCx = userBox.x + userBox.w / 2;
                            const userCy = userBox.y + userBox.h / 2;
                            const adminCx = adminBox.x + adminBox.w / 2;
                            const adminCy = adminBox.y + adminBox.h / 2;
                            const dist = Math.sqrt(Math.pow(userCx - adminCx, 2) + Math.pow(userCy - adminCy, 2));

                            if (iou >= 0.15 || coverageOfAdmin >= 0.3 || dist < 50) {
                                matchedAdminId = adminEv.id;
                                break;
                            }
                        }
                    }

                    // Scoring
                    // Scoring
                    if (item.validity > 0.4) {
                        // AI Confirmed
                        if (matchedAdminId) {
                            if (!matchedEvidenceIds.includes(matchedAdminId)) {
                                evidenceScore += 1000;
                                matchedEvidenceIds.push(matchedAdminId);
                            }
                        } else {
                            // Novel Discovery: Increased reward 1000 (Base) + 250 (Bonus)
                            aiBonus += 1250;

                            // Peer-to-Permanent Evidence Flow: 
                            // If AI is highly confident (>= 0.9) and it's a novel discovery, promote it!
                            if (item.validity >= 0.9) {
                                try {
                                    const newId = `ev_peer_${Math.random().toString(36).substring(2, 9)}`;
                                    await db.prepare(
                                        "INSERT INTO map_evidence (id, location_id, bounding_box, description, is_verified, confidence_score, created_by_user_id, ai_analysis) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
                                    ).bind(
                                        newId, 
                                        trueLoc.id, 
                                        JSON.stringify(userBox), 
                                        item.description || "Student Discovery", 
                                        Math.round(item.validity * 100), 
                                        userId,
                                        "Promoted from high-confidence student discovery."
                                    ).run();
                                    console.log(`[Promotion] Student discovery ${newId} added to permanent evidence for ${trueLoc.id}`);
                                } catch (err) {
                                    console.error("Failed to promote student evidence:", err);
                                }
                            }
                        }
                    } else if (matchedAdminId) {
                        // Geometry Match — student's box overlaps an official box
                        // Give credit even without strong AI confirmation
                        if (!matchedEvidenceIds.includes(matchedAdminId)) {
                            evidenceScore += 750;
                            matchedEvidenceIds.push(matchedAdminId);

                            const adminItem = adminBoxes.find((a: any) => a.id === matchedAdminId);
                            if (adminItem) {
                                item.description = adminItem.description;
                                item.explanation = "Visual confirmation via scanner alignment.";
                                item.validity = 0.8;
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
        const isDifficultyHard = (trueLoc.difficulty_rating || 0) >= 8;
        let finalScore = (distanceScore + evidenceScore + timeScore) * (isDifficultyHard ? 2 : 1);

        if (isDifficultyHard) {
            distanceScore *= 2;
            evidenceScore *= 2;
            timeScore *= 2;
        }

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
        // [BYOK/REAL-TIME] We store the RAW evidence list (boxes) temporarily but we DO store AI feedback.
        await db.prepare(
            "INSERT INTO room_guesses (room_code, location_id, user_id, lat, lng, score, distance, timestamp, evidence_found, ai_feedback, distance_score, evidence_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(code, trueLoc.id, userId, lat, lng, finalScore, distance, Date.now(), JSON.stringify(matchedEvidenceIds), JSON.stringify(aiFeedback), distanceScore, evidenceScore).run();

        // Update Participant Totals (skip for guided round)
        if (!isGuidedRound) {
            // Powerup Energy: Reduced scaling, capped at 30
            const energyEarned = Math.min(30, Math.floor(finalScore / 150) + 5);

            await db.prepare(
                `UPDATE room_participants 
                 SET score = score + ?,
                     powerup_energy = MIN(200, powerup_energy + ?)
                 WHERE room_code = ? AND user_id = ?`
            ).bind(finalScore, energyEarned, code, userId).run();
        }

        // Update User Elo & Accuracies (skip for guided round)
        if (!isGuidedRound && eloChange !== 0) {
            await db.prepare(
                "UPDATE users SET current_elo = MAX(0, current_elo + ?) WHERE id = ?"
            ).bind(eloChange, userId).run();
        }

        // Broadcast a real-time intel event using DO to Teacher
        try {
            const userRec = await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<any>();
            const id = env.GEOHUNTER_ROOM_DO.idFromName(code);
            const obj = env.GEOHUNTER_ROOM_DO.get(id);
            await obj.fetch(new Request("http://internal/broadcast", {
                method: "POST",
                body: JSON.stringify({
                    type: "live_ai_report",
                    payload: {
                        userId: userId,
                        displayName: userRec ? userRec.display_name : "Agent",
                        aiFeedback: aiFeedback
                    }
                })
            }));
        } catch (e) {
            console.error("Failed to broadcast AI report to teacher:", e);
        }

        return Response.json({
            success: true,
            message: "Submission Received.",
            aiFeedback: aiFeedback,
            score: finalScore,
            distance: distance * 1000,
            baseDistanceScore: baseDistanceScore,
            distanceScore: distanceScore,
            evidenceScore: evidenceScore,
            timeScore: timeScore,
            baseTimeMultiplier: baseTimeMultiplier,
            timeMultiplier: timeMultiplier,
            powerupActive: scoreMultiplier
        });

    } catch (error) {
        console.error("SUBMIT ERROR:", error);
        return Response.json({ error: "Internal Server Error", details: (error as any).message }, { status: 500 });
    }
}
