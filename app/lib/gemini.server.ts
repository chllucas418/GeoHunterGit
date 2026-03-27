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
    apiKey?: string,
    responseMimeType?: string,
    useGrounding?: boolean
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

    const payload: any = {
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

    if (responseMimeType && !useGrounding) {
        payload.generationConfig = { responseMimeType };
    }
    
    if (useGrounding) {
        payload.tools = [
            { googleSearch: {} },
            { googleMaps: {} }
        ];
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
            // First Fallback: Cloudflare Unified Billing (Omit API Key)
            if (apiKey) {
                console.warn("[Gemini Fallback] Personal quota hit. Falling back to Cloudflare Unified Billing.");
                return callGeminiApi(
                    modelName,
                    prompt,
                    imageData,
                    baseUrl,
                    gatewayToken,
                    undefined, // Erase API key to let CF Gateway bill the fallback
                    responseMimeType,
                    useGrounding
                );
            }
            // Second Fallback: Downgrade to 2.5-pro if all else fails
            if (modelName.includes("3.1-pro")) {
                console.warn("[Gemini Fallback] 3.1 Pro quota hit completely. Downgrading to 2.5 Pro.");
                return callGeminiApi(
                    "gemini-2.5-pro",
                    prompt,
                    imageData,
                    baseUrl,
                    gatewayToken,
                    apiKey,
                    responseMimeType,
                    useGrounding
                );
            }
        }
        throw new Error(`Cloudflare AI Gateway Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as any;
    const candidate = data?.candidates?.[0];
    if (!candidate?.content?.parts) return "";
    
    // Concatenate all text parts (Gemini 2.5 Flash often returns multiple parts)
    return candidate.content.parts
        .map((p: any) => p.text || "")
        .join("");
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

    // Normalize history: frontend might send {role, content} or {role, text}
    const normalizedHistory = history.map(h => {
        if (h.parts) return h;
        const text = h.content || h.text || "";
        return {
            role: h.role === "model" ? "model" : "user",
            parts: [{ text }]
        };
    });

    const contents = [...normalizedHistory, { role: "user", parts: latestUserParts }];

    const payload: any = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: contents,
        tools: [
            { googleSearch: {} },
            { googleMaps: {} }
        ]
    };

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
            // First Fallback: Cloudflare Unified Billing (Omit API Key)
            if (apiKey) {
                console.warn("[Gemini Chat Fallback] Personal quota hit. Falling back to Cloudflare Unified Billing.");
                return callGeminiChatApi(
                    modelName,
                    systemInstruction,
                    history,
                    newMessage,
                    imageData,
                    baseUrl,
                    gatewayToken,
                    undefined
                );
            }
            // Second Fallback: Downgrade to 2.5-pro
            if (modelName.includes("3.1-pro")) {
                console.warn("[Gemini Chat Fallback] 3.1 Pro quota hit completely. Downgrading to 2.5 Pro.");
                return callGeminiChatApi(
                    "gemini-2.5-pro",
                    systemInstruction,
                    history,
                    newMessage,
                    imageData,
                    baseUrl,
                    gatewayToken,
                    apiKey
                );
            }
        }
        throw new Error(`Cloudflare AI Gateway Chat Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as any;
    // Return both the text and the full candidate (to capture groundingMetadata if needed)
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts
        ? candidate.content.parts.map((p: any) => p.text || "").join("")
        : "";

    return {
        text,
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
    directBase64?: string,
    lat?: number,
    lng?: number
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
    ${lat && lng ? `Coordinates: ${lat}, ${lng}. EXPLICITLY USE YOUR GOOGLE MAPS AND GOOGLE SEARCH GROUNDING TOOLS to verify these coordinates and the surrounding area before generating insight.` : ''}

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
            "gemini-3.0-flash-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            "application/json",
            true
        );

        try {
            const parsed = JSON.parse(responseText.trim());
            if (!parsed.results) parsed.results = [];
            return parsed;
        } catch (e) {
            console.error("JSON Parse Error:", e);
            const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (!parsed.results) parsed.results = [];
                return parsed;
            }
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
    let base64Data = "";
    let mimeType = "image/jpeg";

    if (imageUrl.startsWith("data:")) {
        const parts = imageUrl.split(",");
        mimeType = parts[0].split(":")[1].split(";")[0];
        base64Data = parts[1];
    } else {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("Failed to fetch image");

        const arrayBuffer = await response.arrayBuffer();
        base64Data = arrayBufferToBase64(arrayBuffer);
        mimeType = response.headers.get("content-type") || "image/jpeg";
    }

    let contextStr = "";
    if (context?.lat && context?.lng) {
        contextStr += `\nLocation Coordinates: ${context.lat}, ${context.lng}`;
    }
    if (context?.evidenceList && context.evidenceList.length > 0) {
        contextStr += `\nPre-identified Visual Evidence:\n${JSON.stringify(context.evidenceList, null, 2)}`;
    }

    const prompt = `
    You are a technical geolocation analyst providing raw factual data.
    
    Task:
    Analyze the image and provided context to generate a factual description and three progressive hints.
    CRITICAL INSTRUCTION: You MUST use BOTH your Google Search and Google Maps tools at the same time to search for the EXACT coordinates provided in the context (if available). Consolidate your findings from both the Web Search tool and the Google Maps tool to determine the exact real-world location and its surrounding points of interest. Do NOT guess the location. Use your tools to find what map features, businesses, and transport links are ACTUALLY present at those exact coordinates. Base your hints STRICTLY on the real places and roads found via search at that specific coordinate.
    
    Context:
    ${contextStr}
    
    Tone and Style (ABSOLUTE RESTRICTION):
    - **NO FANCY WORDS**: Strictly forbid words like "shimmering," "whispering," "nestled," "vibrant," "azure," "quaint," "atmosphere," "vibe," or any poetic language.
    - **NO STORYTELLING**: Do not try to "draw a picture." Do not mention lighting, mood, or feelings.
    - **FACTUAL ONLY**: Describe ONLY physical objects, colors, building heights, street names, and verified landmarks at the exact coordinates.
    - **TECHNICAL TONE**: Your output should read like a dry building survey or a police report.

    Instructions for Hints (STRICT):
    You MUST generate ACTUAL PUZZLE HINTS that help the player figure out the location. Do NOT guess generic rail stations if they aren't verified by your search tool at the exact coordinates!
    1. **Hint 1 (Broad clue)**: Give a high-level geographical or architectural clue based on the exact district or neighborhood from your coordinate search.
    2. **Hint 2 (Medium clue)**: Focus on distinct landmarks, transport links, or facility names verified by search to be immediately adjacent to the coordinates. 
    3. **Hint 3 (Specific clue)**: Give a highly specific, nearly-giveaway clue involving exact street names, estate names, or exact shop signs right next to the location.
    
    Orientation Analysis:
    - Identify the camera's orientation (e.g., "Facing North-East").
    - Ensure all hints are grounded in this factual orientation.

    Output strictly in this JSON format:
    {
      "precontext": "string (Factual description of physical objects)",
      "generated_hints": ["Hint 1", "Hint 2", "Hint 3"],
      "hint_pins": [{"description": "Short label", "lat": number, "lng": number}],
      "quality_score": number,
      "difficulty_rating": number,
      "recommendation": "string"
    }
    `;

    try {
        const responseText = await callGeminiApi(
            "gemini-3.1-pro-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            "application/json",
            true
        );

        try {
            return JSON.parse(responseText.trim());
        } catch (e) {
            console.error("JSON Parse Fallback Error:", e);
            const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
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
    Identify the object in this bounding box:
    x: ${evidenceBox.x}%, y: ${evidenceBox.y}%, width: ${evidenceBox.w}%, height: ${evidenceBox.h}%.
    
    Tone: Strictly factual. 
    1. Identify the object.
    2. Provide a 1-sentence description using only physical attributes (color, material, type).
    3. No "fancy" words. Keep it under 20 words.
    `;

    try {
        const description = await callGeminiApi(
            "gemini-3.1-pro-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            undefined,
            true
        );
        return description.trim();
    } catch (e: any) {
        console.error("AI Gateway Error:", e);
        return `Analysis failed: ${e.message}`;
    }
}

export async function autoDetectMapEvidence(
    imageUrl: string,
    locationData: { lat: number, lng: number, name?: string },
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

    const { lat, lng, name } = locationData;
    const locationContext = name ? `Location Name: ${name}. Coordinates: ${lat}, ${lng}` : `Coordinates: ${lat}, ${lng}`;

    const prompt = `
    You are an expert geolocation analyst specialized in factual GSV (Google Street View) map grounding.
    
    Context:
    ${locationContext}
    
    Tone and Style (STRICT):
    - **PLAIN ENGLISH ONLY**: No "fancy" words or storytelling.
    - **OBJECTIVE**: Descriptions must be raw physical data.
    
    Pre-Analysis:
    - Determine camera orientation (e.g., Facing North).
    
    Targeting Instructions:
    1. **Significant Landmarks Only**: Permanent markers distinctive to the area and found on Google Maps.
    2. **Examples**: Store names, building facades, estate entrances.
    3. **EXCLUSION ZONE**: IGNORE lamp posts, traffic lights, trash cans, trees, or generic street signs.
    
    Instructions:
    - provide a bounding box (0-1000 system).
    - Provide a short, factual description (max 10 words).
    
    Output strictly in this JSON format:
    {
      "evidence": [
        {
          "description": "Factual name of landmark (e.g., 'Tuen Mun Town Plaza Entrance')",
          "box": { "x": number, "y": number, "w": number, "h": number }
        }
      ]
    }
    `;

    try {
        // Enforce the smartest available model (gemini-3.1-pro-preview) for complex spatial analysis
        const responseText = await callGeminiApi(
            "gemini-3.1-pro-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            "application/json",
            true // Enable tools (Google Search/Maps Grounding)
        );

        try {
            const parsed = JSON.parse(responseText.trim());
            return parsed.evidence || [];
        } catch (e) {
            console.warn("[Gemini] JSON Parse Fallback in autoDetectMapEvidence:", e);
            const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed.evidence || [];
            }
            throw e;
        }
    } catch (e: any) {
        console.error("Auto-Detect AI Gateway Error:", e);
        throw new Error(`Auto-Detect failed: ${e.message}`);
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
            "gemini-3.1-pro-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            "application/json",
            true
        );

        try {
            const parsed = JSON.parse(responseText.trim());
            return parsed.results || [];
        } catch (e) {
            const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed.results || [];
            }
        }
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: Invalid JSON response` }));
    } catch (e: any) {
        console.error("Batch Analysis Failed via Gateway", e);
        return items.map((item: any) => ({ id: item.id, ai_analysis: `Analysis failed: ${e.message}` }));
    }
}

export async function classifyBatchImages(
    images: { mimeType: string; data: string }[],
    baseUrl: string,
    gatewayToken: string,
    apiKey: string
) {
    if (images.length === 0) return [];

    const prompt = `
    Analyze these ${images.length} images. 
    Identify which images are likely to be "True Location" real-world photographs suitable for a geolocation identfication game (buildings, streets, landmarks in Hong Kong).
    Exclude: Logos, decorative graphics, UI icons, generic template art, or unrelated text charts.
    
    Return a JSON array of the indices (0 to ${images.length - 1}) that represent real-world location photos.
    Format: { "valid_indices": [0, 2, 5...] }
    `;

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = apiKey
        ? `${cleanBaseUrl}/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
        : `${cleanBaseUrl}/v1beta/models/gemini-1.5-flash:generateContent`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (gatewayToken) {
        headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    const payload: any = {
        contents: [{
            parts: [
                { text: prompt },
                ...images.map(img => ({
                    inlineData: {
                        mimeType: img.mimeType,
                        data: img.data
                    }
                }))
            ]
        }],
        generationConfig: { responseMimeType: "application/json" }
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Status: ${response.status}`);
        
        const data = await response.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const parsed = JSON.parse(text.trim());
        return Array.isArray(parsed.valid_indices) ? parsed.valid_indices : [];
    } catch (e) {
        console.error("[Gemini] Batch classification failed:", e);
        // Fallback: return everything so we don't block work if AI fails
        return images.map((_, i) => i);
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
            "gemini-3.1-pro-preview",
            prompt,
            { mimeType, data: base64Data },
            baseUrl,
            gatewayToken,
            apiKey,
            undefined,
            true
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
    directBase64?: string,
    currentState?: { description?: string; hints?: string[] }
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

    const stateStr = currentState 
        ? `\nCURRENT STATE (Metadata already recorded):\nDescription: "${currentState.description || 'None'}"\nHints: ${JSON.stringify(currentState.hints || [])}\n`
        : "";

    const systemInstruction = `
You are a highly capable AI assistant specifically designed to help the Admin/Teacher create official "Map Evidence" and "Hints" for a geography identification game called GeoHunter.
You have access to Google Search to look up real-world locations based on the provided coordinates or image.

Context:
${contextStr}
${evidenceStr}
${stateStr}

1. Act as a collaborative partner. Answer the admin's questions about the location, architecture, history, or specific objects in the image.
2. When suggesting descriptions (via "precontext"), provide an "Informative Snapshot". Use clear, deductive language. Avoid flowery or "fancy" words. Focus on identifiers that help a student ground the location on a map.
3. **Tuen Mun Context**: ALL locations in this game are within Tuen Mun, Hong Kong. Therefore, hints mentioning "Hong Kong", "New Territories", or "South China" are redundant and forbidden. 
4. **Local Specifics**: Focus on hyper-local Tuen Mun identifiers: specific Public Housing Estates (e.g., Butterfly Estate, On Ting), Light Rail (LRT) station quirks, shopping centers (V City), or distinct geography (Castle Peak).
5. **Double-Check Content**: FIRST provide a clear, human-readable summary in plain text, THEN provide the structured JSON block. Use the "suggestFullMetadata" action whenever possible.

ACTIONABLE OUTPUT (JSON FORMAT):
Use these JSON blocks ONLY. Conversational text should go outside the blocks.

TO SUGGEST BOTH DESCRIPTION AND HINTS (Consolidated Metadata):
\`\`\`json
{
  "action": "suggestFullMetadata",
  "data": {
    "description": "Clear informative description text...",
    "hints": ["Hint 1", "Hint 2", "Hint 3"]
  }
}
\`\`\`

TO SUGGEST INDIVIDUAL UPDATES:
- Hints only: {"action": "setHints", "data": ["...", "..."]}
- Description only: {"action": "setDescription", "data": "..."}
- Single hint add: {"action": "addHint", "data": "..."}

You can output conversational text alongside these JSON blocks. The UI will parse the JSON blocks into interactive preview cards.
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
