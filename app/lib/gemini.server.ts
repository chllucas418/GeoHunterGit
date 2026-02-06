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

    CRITICAL: ALWAYS Provide a "summary_explanation".
    - If the user missed key evidence or provided no evidence, explain clearly how the GROUND TRUTH items help identify this location. 
    - e.g. "You missed the [Clue A] and [Clue B]. These are critical because..."
    - Be educational and encouraging.

    Return a JSON OBJECT with:
    - "results": ARRAY of objects (same as before: index, validity, matched_admin_index, description, explanation)
    - "summary_explanation": string (The educational summary)
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
    // Clean potential markdown blocks
    const cleanText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    return { quality_score: 50, precontext: "AI analysis failed", recommendation: "Review manually", generated_hints: [] };
}
