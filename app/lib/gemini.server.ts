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

export async function checkEvidenceWithGemini(
    apiKey: string,
    imageUrl: string,
    box: { x: number; y: number; w: number; h: number },
    locationName: string
) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // User requested "gemini 3 flash strictly". 
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);

    const prompt = `
    Analyze the image inside the bounding box defined by: x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h} (coordinates are relative to image dimensions).
    Does this area contain valid visual evidence (text, landmarks, distinct architecture) that helps identify the location "${locationName}"?
    
    Return a JSON object with:
    - "validity": number (0.0 to 1.0)
    - "explanation": string
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
    // Clean markdown json
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    return { validity: 0, explanation: "Failed to parse AI response" };
}
