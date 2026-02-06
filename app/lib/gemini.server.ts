import { GoogleGenerativeAI } from "@google/generative-ai";

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

export async function checkEvidenceListWithGemini(
    apiKey: string,
    imageUrl: string,
    evidenceList: { box: { x: number; y: number; w: number; h: number }; description?: string }[],
    locationName: string,
    adminEvidence: any[] = []
) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);

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
       - Valid: HIGH (0.8-1.0)
       - Matched Index: The index (0-based) of the Ground Truth item in the provided list.
       - Description: Identify the object using the Official Clue name.
       - Explanation: "Correctly identified [Official Clue Name]."
    3. If the user found a legitimate clue that is NOT in the Ground Truth (a "Novel Discovery"):
       - Valid: HIGH (0.7-0.9)
       - Matched Index: -1
       - Description: Describe what it is.
       - Explanation: "Good eye! You spotted [Feature] which wasn't in our database."
    4. If invalid/random/empty:
       - Valid: LOW.
       - Matched Index: -1
       - Explanation: "Generic feature."

    Return a JSON ARRAY of objects with:
    - "index": number (matching input USER array index)
    - "validity": number (0.0 to 1.0)
    - "matched_admin_index": number (0-based index of the Admin Evidence matched, or -1 if none)
    - "description": string (AI generated description)
    - "explanation": string (reason)
  `;
    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType: response.headers.get("content-type") || "image/jpeg",
            },
        },
    ]);

    const responseText = result.response.text();
    console.log("Gemini Raw Response:", responseText); // Debug logging

    // Clean up markdown code blocks if present
    // Clean up markdown code blocks if present
    let cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

    // Find the outer-most array brackets
    const startIndex = cleanText.indexOf('[');
    const endIndex = cleanText.lastIndexOf(']');

    if (startIndex !== -1 && endIndex !== -1) {
        try {
            const jsonStr = cleanText.substring(startIndex, endIndex + 1);
            return { results: JSON.parse(jsonStr) };
        } catch (e) {
            console.error("JSON Parse Error:", e);
            // Try to rescue if it's just a single object wrapped in array logic
            return { results: [] };
        }
    }
    // Fallback: Check for single object
    const startObj = cleanText.indexOf('{');
    const endObj = cleanText.lastIndexOf('}');
    if (startObj !== -1 && endObj !== -1) {
        try {
            const jsonStr = cleanText.substring(startObj, endObj + 1);
            // unexpected single object, wrap it
            return { results: [JSON.parse(jsonStr)] };
        } catch (e) { }
    }

    return { results: [] };
}

export async function analyzeImageQuality(
    apiKey: string,
    imageUrl: string,
    context?: {
        lat?: number;
        lng?: number;
        evidenceList?: any[]; // optional pre-filled evidence
    }
) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);

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
    4. Provide a brief "precontext" description of what you see.
    ${context?.lat ? "5. Verify if the visual environment matches the provided coordinates." : ""}
    
    Return a JSON object with:
    - "quality_score": number
    - "difficulty_rating": number
    - "precontext": string
    - "recommendation": string (e.g., "Ready for deployment" or "Too blurry")
  `;

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType: response.headers.get("content-type") || "image/jpeg",
            },
        },
    ]);

    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    return { quality_score: 50, precontext: "AI analysis failed", recommendation: "Review manually" };
}
