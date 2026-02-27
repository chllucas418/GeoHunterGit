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

// Helper for raw fetch to Gemini API
async function callGeminiApi(
    apiKey: string,
    modelName: string,
    prompt: string,
    imageData: { mimeType: string; data: string },
    baseUrl: string = "https://generativelanguage.googleapis.com",
    gatewayToken?: string
) {
    const url = `${baseUrl}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };

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
        throw new Error(`Gemini API Error: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    const data = await response.json() as any;
    // Extract text from standard Gemini response structure
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function checkEvidenceListWithGemini(
    apiKey: string,
    imageUrl: string,
    evidenceList: { box: { x: number; y: number; w: number; h: number }; description?: string }[],
    locationName: string,
    adminEvidence: any[] = [],
    baseUrl?: string,
    gatewayToken?: string,
    directBase64?: string // Optional: Pass base64 directly if image is local
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

    // Prepare Admin Context String for the AI
    const adminContextStr = adminEvidence.map((e, i) =>
        `Official Clue #${i + 1}: "${e.description}"`
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
       - **STRICT CRITERIA:** Only accept if it is **legible text** (shop sign, street name) or a **highly unique landmark** (statue, distinct mural).
       - **REJECT** generic features like "red wall", "pavement", "tree", "sky", "building corner" with LOW validity (0.1).
       - If Valid: HIGH (0.7-0.9).
       - Matched Index: -1.
       - Description: Describe specifically what it is.
       - Explanation: "Good eye! You spotted [Feature] which wasn't in our database."
    4. If invalid/random/empty/generic:
       - Valid: LOW (0.0 - 0.1).
       - Matched Index: -1.
       - Explanation: "Generic feature (e.g. wall, road, sky) or unclear."

    CRITICAL: ALWAYS Provide a "summary_explanation".
    - If the user missed key evidence or provided no evidence, explain clearly how the GROUND TRUTH items help identify this location. 
    - Focus on the "HOW" and "WHY". e.g. "The width of the crosswalk stripes indicates Region A, while the blue sign is specific to District B."
    - Be educational and encouraging.

    For each "Common Match" or "Novel Discovery" item explanation:
    - Do NOT just say "Correctly identified".
    - Explain WHY it matters. e.g. "Correct! This specific tactile paving pattern is unique to Hong Kong."


    Return a JSON OBJECT with:
    - "results": ARRAY of objects (same as before: index, validity, matched_admin_index, description, explanation)
    - "summary_explanation": string (The educational summary)
  `;

    try {
        const responseText = await callGeminiApi(
            apiKey,
            "gemini-3-flash", // User explicitly requested this model
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken
        );

        console.log("Gemini Raw Response:", responseText);

        // Clean up markdown code blocks if present
        let cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        // Try to parse the whole object first
        try {
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // Ensure results array exists
                if (!parsed.results) parsed.results = [];
                return parsed;
            }
        } catch (e) {
            console.error("JSON Parse Error:", e);
        }

        // Fallback: If strict parsing fails, try to salvage results array if possible, or return empty
        return { results: [], summary_explanation: "AI feedback unavailable." };

    } catch (e) {
        console.error("Gemini API Call Error:", e);
        return { results: [], summary_explanation: "AI service error." };
    }
}

export async function analyzeImageQuality(
    apiKey: string,
    imageUrl: string,
    context?: {
        lat?: number;
        lng?: number;
        evidenceList?: any[]; // optional pre-filled evidence
    },
    baseUrl?: string,
    gatewayToken?: string
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
            apiKey,
            "gemini-3-flash",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken
        );

        const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { quality_score: 50, precontext: "AI analysis failed", recommendation: "Review manually", generated_hints: [] };

    } catch (e: any) {
        console.error("Gemini API Call Error:", e);
        return { quality_score: 0, precontext: `Analysis failed: ${e.message}`, recommendation: "Error", generated_hints: [] };
    }
}

export async function generateEvidenceDescription(
    apiKey: string,
    imageUrl: string,
    evidenceBox: { x: number; y: number; w: number; h: number },
    baseUrl?: string,
    gatewayToken?: string,
    directBase64?: string // Optional: Pass base64 directly if image is local
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
        // 1. Fetch image to base64
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
            apiKey,
            "gemini-3-flash",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken
        );
        return description.trim();
    } catch (e: any) {
        console.error("Gemini Description gen failed", e);
        return `Analysis failed: ${e.message}`;
    }
}

export async function batchAnalyzeOfficialEvidence(
    apiKey: string,
    imageUrl: string,
    items: { id: string; box: any; description: string }[],
    baseUrl?: string,
    gatewayToken?: string
) {
    // 1. Fetch image
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    // 2. Build Context
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
            apiKey,
            "gemini-3-flash",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken
        );

        const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.results || [];
        }
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: Invalid JSON response - ${responseText.substring(0, 100)}` }));
    } catch (e: any) {
        console.error("Batch Analysis Failed", e);
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: ${e.message}` }));
    }
}
