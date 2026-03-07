// Helper to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Helper for raw fetch to Gemini API via Cloudflare AI Gateway
async function callGeminiApi(
    modelName: string,
    prompt: string,
    imageData: { mimeType: string; data: string },
    baseUrl: string,
    gatewayToken: string,
    apiKey?: string
) {
    if (!baseUrl) {
        throw new Error("GEMINI_BASE_URL is not set. Cannot call Gemini API.");
    }

    // Ensure the base URL does not end with a slash
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    // If apiKey provided, append ?key= (direct auth). Otherwise rely on BYOK configured in AI Gateway dashboard.
    const url = apiKey
        ? `${cleanBaseUrl}/v1beta/models/${modelName}:generateContent?key=${apiKey}`
        : `${cleanBaseUrl}/v1beta/models/${modelName}:generateContent`;

    console.log(`[Gemini] Calling: ${cleanBaseUrl}/v1beta/models/${modelName}:generateContent (BYOK: ${!apiKey})`);

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    // Add gateway auth if token is provided (authenticates to Cloudflare AI Gateway)
    if (gatewayToken) {
        headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inlineData: {
                        mimeType: imageData.mimeType,
                        data: imageData.data
                    }
                }
            ]
        }]
    };

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Cloudflare AI Gateway Error: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    const data = await response.json() as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Helper for raw fetch to Gemini API with chat history and tools
async function callGeminiChatApi(
    modelName: string,
    systemInstruction: string,
    history: any[], // { role, parts: [{text}] }
    newMessage: string,
    imageData: { mimeType: string; data: string } | null,
    baseUrl: string,
    gatewayToken: string,
    apiKey?: string
) {
    if (!baseUrl) {
        throw new Error("GEMINI_BASE_URL is not set. Cannot call Gemini API.");
    }

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = apiKey
        ? `${cleanBaseUrl}/v1beta/models/${modelName}:generateContent?key=${apiKey}`
        : `${cleanBaseUrl}/v1beta/models/${modelName}:generateContent`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (gatewayToken) {
        headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    // Construct the new message part
    const latestUserParts: any[] = [{ text: newMessage }];

    // Inject image into the latest message if provided
    if (imageData) {
        latestUserParts.push({
            inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.data
            }
        });
    }

    const contents = [...history, { role: "user", parts: latestUserParts }];

    const payload = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: contents,
        tools: [
            { googleSearch: {} }
        ]
    };

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Cloudflare AI Gateway Chat Error: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    const data = await response.json() as any;
    // Return both the text and the full candidate (to capture groundingMetadata if needed)
    const candidate = data?.candidates?.[0];
    return {
        text: candidate?.content?.parts?.[0]?.text || "",
        candidate: candidate
    };
}

export async function checkEvidenceListWithGemini(
    imageUrl: string,
    evidenceList: { box: { x: number; y: number; w: number; h: number }; description?: string }[],
    locationName: string,
    adminEvidence: any[] = [],
    baseUrl: string,
    gatewayToken: string,
    apiKey: string,
    directBase64?: string
) {
    let base64Data = "";
    let mimeType = "image/jpeg";

    if (directBase64) {
        if (directBase64.startsWith("data:")) {
            const parts = directBase64.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        } else {
            base64Data = directBase64;
        }
    } else {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Failed to fetch image");

        const arrayBuffer = await response.arrayBuffer();
        base64Data = arrayBufferToBase64(arrayBuffer);
        mimeType = response.headers.get("content-type") || "image/jpeg";
    }

    const adminContextStr = adminEvidence.map((e, i) =>
        `Official Clue #${i + 1} (Database ID: '${e.id}'): "${e.description}"`
    ).join("\n");

    const prompt = `
    Analyze the image and the following USER marked evidence regions.
    Location: "${locationName}".

    GROUND TRUTH (Official Evidence for this location):
    ${adminContextStr}

    USER'S EVIDENCE LIST (Boxes marked by player):
    ${JSON.stringify(evidenceList.map(e => ({ box: e.box })), null, 2)}

    For each USER item:
    1. Compare the user's box with the GROUND TRUTH clues (by visual content and location).
    2. If the user's box matches a Ground Truth clue:
       - **STRICTLY EVALUATE visual content.** Does the box actually contain the object?
       - If yes: Valid: HIGH (0.8-1.0).
       - Matched Index: The index (0-based) of the Ground Truth item.
       - Description: Identify the object using the Official Clue name.
       - Explanation: "Correctly identified [Official Clue Name]."
       - If the box is nearby but misses the actual feature visually (e.g. empty wall next to sign), validity = 0.2.
    3. If the user found a legitimate clue that is NOT in the Ground Truth (a "Novel Discovery"):
       - **STRICT CRITERIA:** Only accept if it is **legible text** (shop sign, street name) or a **highly unique landmark** (statue, distinct mural, architectural oddity).
       - **REJECT** generic features like "red wall", "pavement", "tree", "sky", "building corner" with LOW validity (0.1).
       - If Valid: HIGH (0.7-0.95). 
       - **PROMOTION SIGNAL:** If validity is >= 0.9, it means the discovery is "Ground Truth Quality" (accurate, well-framed, and unique). 
       - Matched Index: -1.
       - Description: Provide a concise (max 10 words) official-sounding name for this feature (e.g. "St. Paul's Secondary School Signage").
       - Explanation: "Excellent discovery! You found [Feature], a high-confidence landmark we'll add to our records."
    4. If invalid/random/empty/generic:
       - Valid: LOW (0.0 - 0.1).
       - Matched Index: -1.
       - Explanation: "Generic feature (e.g. wall, road, sky) or unclear."

    CRITICAL: ALWAYS Provide a "summary_explanation".
    - Focus on the "HOW" and "WHY" of the overall location identification. e.g. "The width of the crosswalk stripes indicates Region A, while the blue sign is specific to District B."
    - Be educational and encouraging.

    CRITICAL: For each GROUND TRUTH item that the user DID NOT successfully match (based on the steps above), provide a dynamic educational explanation of *why* they missed it or *where* it is located in the context of their image analysis. 

    Return a JSON OBJECT with:
    - "results": ARRAY of objects (index, validity, matched_admin_index, description, explanation)
    - "summary_explanation": string (The educational summary)
    - "missed_evidence_explanations": ARRAY of objects containing {"admin_id": string, "explanation": string} using the Database IDs provided in the GROUND TRUTH section.
  `;

    try {
        const responseText = await callGeminiApi(
            "gemini-3-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey
        );

        let cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        try {
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (!parsed.results) parsed.results = [];
                return parsed;
            }
        } catch (e) {
            console.error("JSON Parse Error:", e);
        }

        return { results: [], summary_explanation: "AI feedback unavailable." };

    } catch (e) {
        console.error("Cloudflare AI Gateway / Gemini Error:", e);
        return { results: [], summary_explanation: "AI service error." };
    }
}

export async function analyzeImageQuality(
    imageUrl: string,
    baseUrl: string,
    gatewayToken: string,
    apiKey: string,
    context?: {
        lat?: number;
        lng?: number;
        evidenceList?: any[];
    }
) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    let contextStr = "";
    if (context?.lat && context?.lng) {
        contextStr += `\nLocation Coordinates: ${context.lat}, ${context.lng}`;
    }
    if (context?.evidenceList && context.evidenceList.length > 0) {
        contextStr += `\nPre-identified Visual Evidence:\n${JSON.stringify(context.evidenceList, null, 2)}`;
    }

    const prompt = `
    Analyze this image for a geography identification game. ${contextStr}
    
    1. Is the image clear enough to identify landmarks or locations?
    2. Suggest a "quality_score" from 0 to 100 based on clarity and uniqueness.
    3. Suggest a "difficulty_rating" from 1 to 10 based on how hard it would be to find this exact spot.
    4. Provide a brief "precontext" description of what you see. CRITICAL: Do NOT reveal the location name, specific coordinates, or any direct spoilers. Keep it atmospheric.
    ${context?.lat ? "5. Verify if the visual environment matches the provided coordinates." : ""}
    6. Generate 3 progressive hints for players.
       ${context?.evidenceList && context.evidenceList.length > 0
            ? `CRITICAL: The admin has identified these key "Ground Truth" items: ${JSON.stringify(context.evidenceList.map((e: any) => e.description || e))}. 
            Your hints must subtly guide the player towards finding these specific items without explicitly naming them in the first two hints.`
            : "Focus on general visual features."}
       - Hint 1: Visual/Vague (High-level, e.g. "Focus on the architectural style or the color of the signage").
       - Hint 2: Contextual (Mid-level, e.g. "The vegetation suggests a tropical climate, look for specific trees").
       - Hint 3: Specific (Direct clue but still playful, e.g. "A unique feature on the left wall holds the key").
    
    Return a JSON object with:
    - "quality_score": number
    - "difficulty_rating": number
    - "precontext": string
    - "recommendation": string (e.g., "Ready for deployment" or "Too blurry")
    - "generated_hints": string[] (Array of 3 suggestion strings)
  `;

    try {
        const responseText = await callGeminiApi(
            "gemini-3-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey
        );

        const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { quality_score: 50, precontext: "AI analysis failed", recommendation: "Review manually", generated_hints: [] };

    } catch (e: any) {
        console.error("AI Gateway Error:", e);
        return { quality_score: 0, precontext: `Analysis failed: ${e.message}`, recommendation: "Error", generated_hints: [] };
    }
}

export async function generateEvidenceDescription(
    imageUrl: string,
    evidenceBox: { x: number; y: number; w: number; h: number },
    baseUrl: string,
    gatewayToken: string,
    apiKey: string,
    directBase64?: string
) {
    let base64Data = "";
    let mimeType = "image/jpeg";

    if (directBase64) {
        if (directBase64.startsWith("data:")) {
            const parts = directBase64.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        } else {
            base64Data = directBase64;
        }
    } else {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Failed to fetch image");
        const arrayBuffer = await response.arrayBuffer();
        base64Data = arrayBufferToBase64(arrayBuffer);
        mimeType = response.headers.get("content-type") || "image/jpeg";
    }

    const prompt = `
    Analyze the specific region of the image defined by this bounding box:
    x: ${evidenceBox.x}%, y: ${evidenceBox.y}%, width: ${evidenceBox.w}%, height: ${evidenceBox.h}% (Percentages of image dimensions).
    
    1. Identify the object or feature inside this box.
    2. Provide a concise, 1-sentence analytical description of what this evidence represents in the context of a geolocation game (e.g., "Unique architectural style of the 19th century", "Specific street sign font used in this region").
    3. Keep it under 30 words.
    `;

    try {
        const description = await callGeminiApi(
            "gemini-3-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey
        );
        return description.trim();
    } catch (e: any) {
        console.error("AI Gateway Error:", e);
        return `Analysis failed: ${e.message}`;
    }
}

export async function batchAnalyzeOfficialEvidence(
    imageUrl: string,
    items: { id: string; box: any; description: string }[],
    baseUrl: string,
    gatewayToken: string,
    apiKey: string
) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    const itemsStr = items.map((item, i) =>
        `Item ${i}: ID="${item.id}", Description="${item.description}", Box=${JSON.stringify(item.box)}`
    ).join("\n");

    const prompt = `
    Analyze the following "Official Evidence" items in the image.
    
    ITEMS:
    ${itemsStr}
    
    For each item:
    1. Look at the region defined by the 'Box' (x, y, w, h in %) within the image.
    2. Provide a sophisticated, educational "ai_analysis" (max 2 sentences) describing WHY this feature is a unique identifier for the location.
    3. Refer to the visual details (e.g., "The specific blue hue of the sign...", "The colonial style of the pillar...").
    
    Return a JSON object:
    {
        "results": [
            { "id": "item_id_from_input", "ai_analysis": "The analysis text..." }
        ]
    }
    `;

    try {
        const responseText = await callGeminiApi(
            "gemini-3-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey
        );

        const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.results || [];
        }
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: Invalid JSON response` }));
    } catch (e: any) {
        console.error("Batch Analysis Failed via Gateway", e);
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: ${e.message}` }));
    }
}

export async function generateSocraticHint(
    imageUrl: string,
    locationName: string,
    studentQuery: string,
    curriculumFocus: string,
    baseUrl: string,
    gatewayToken: string,
    apiKey: string,
    directBase64?: string
) {
    let base64Data = "";
    let mimeType = "image/jpeg";

    if (directBase64) {
        if (directBase64.startsWith("data:")) {
            const parts = directBase64.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        } else {
            base64Data = directBase64;
        }
    } else {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Failed to fetch image");
        const arrayBuffer = await response.arrayBuffer();
        base64Data = arrayBufferToBase64(arrayBuffer);
        mimeType = response.headers.get("content-type") || "image/jpeg";
    }

    const focusInstruction = curriculumFocus !== "None"
        ? `CRITICAL: Frame your clue around this Tuen Mun specific curriculum focus: "${curriculumFocus}". Highlight elements like Light Rail stations, specific Public Estate designs, terrain, or cultural landmarks that match this focus.`
        : `Frame your clue around Tuen Mun area specifics (estates, LRT, geography).`;

    const prompt = `
    You are an AI Socratic Tutor for a geography identification game set in Tuen Mun, Hong Kong.
    The true location of this image is: "${locationName}".
    
    The student is asking: "${studentQuery}"
    
    ${focusInstruction}

    RULES for Socratic Hints:
    1. DO NOT give them the direct answer or the name of the location.
    2. Respond with a thought-provoking question or a subtle observation about the image.
    3. Encourage them to look at specific visual evidence (e.g. signage color, building age, background mountains).
    4. Keep it concise (1-2 sentences).
    5. Be encouraging and mysterious ("Agent, consider...")
    `;

    try {
        const responseText = await callGeminiApi(
            "gemini-3-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey
        );
        return responseText.trim();
    } catch (e: any) {
        console.error("Socratic Hint Error via Gateway:", e);
        return "Warning: Info-Link degraded. Check the architectural style again.";
    }
}

export async function chatWithGemini(
    modelName: string,
    message: string,
    history: any[],
    contextUrl: string,
    locationData: { lat: number; lng: number } | null,
    evidenceList: any[],
    baseUrl: string,
    gatewayToken: string,
    apiKey: string,
    directBase64?: string
) {
    let base64Data = "";
    let mimeType = "image/jpeg";
    let imageData = null;

    if (directBase64) {
        if (directBase64.startsWith("data:")) {
            const parts = directBase64.split(",");
            mimeType = parts[0].split(":")[1].split(";")[0];
            base64Data = parts[1];
        } else {
            base64Data = directBase64;
        }
        imageData = { mimeType, data: base64Data };
    }

    const contextStr = locationData
        ? `Location Coordinates: ${locationData.lat}, ${locationData.lng}\n`
        : "";

    const evidenceStr = evidenceList && evidenceList.length > 0
        ? `Currently Marked Evidence:\n${JSON.stringify(evidenceList, null, 2)}\n`
        : "No evidence marked yet.\n";

    const systemInstruction = `
You are a highly capable AI assistant specifically designed to help the Admin/Teacher create official "Map Evidence" and "Hints" for a geography identification game called GeoHunter.
You have access to Google Search to look up real-world locations based on the provided coordinates or image.

Context:
${contextStr}
${evidenceStr}

Core Responsibilities:
1. Act as a collaborative partner. Answer the admin's questions about the location, architecture, history, or specific objects in the image.
2. If the admin asks for hints, you can suggest them.
3. If the admin asks you to identify good evidence points, suggest them.

ACTIONABLE OUTPUT (JSON FORMAT):
When you want to explicitly suggest a hint or an evidence description that the admin can add with one click, include it in your response as a JSON block using this exact format:

TO SUGGEST A HINT:
\`\`\`json
{
  "action": "addHint",
  "data": "The suggested hint text here"
}
\`\`\`

TO SUGGEST AN EVIDENCE DESCRIPTION (if they have drawn a box):
\`\`\`json
{
  "action": "addEvidenceDescription",
  "data": "The suggested succinct description here"
}
\`\`\`

You can output conversational text alongside these JSON blocks. The UI will parse the JSON blocks and turn them into interactive buttons for the admin.
Keep your conversational responses helpful, insightful, and concise. Use Google Search to verify real-world facts if you are unsure.
    `.trim();

    try {
        const response = await callGeminiChatApi(
            modelName,
            systemInstruction,
            history,
            message,
            imageData,
            baseUrl,
            gatewayToken,
            apiKey
        );
        return response.text;
    } catch (e: any) {
        console.error("AI Chat Error:", e);
        throw new Error(`Chat failed: ${e.message}`);
    }
}
