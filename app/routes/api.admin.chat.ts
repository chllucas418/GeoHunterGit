import { type ActionFunctionArgs, json } from "@remix-run/cloudflare";
import { requireDeveloper } from "~/lib/auth.server";
import { chatWithGemini } from "~/lib/gemini.server";

export async function action({ request, context }: ActionFunctionArgs) {
    if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        await requireDeveloper(request);
    } catch (e) {
        return json({ error: "Unauthorized" }, { status: 401 });
    }

    const env = context.cloudflare.env as any;
    
    try {
        const body = await request.json() as any;
        const { modelName, message, history, base64Image, location, evidenceList } = body;

        if (!message) {
            return json({ error: "Message is required" }, { status: 400 });
        }

        const model = modelName || "gemini-3.0-flash"; // Default to flash

        const responseText = await chatWithGemini(
            model,
            message,
            history || [],
            "", // contextUrl unused
            location || null,
            evidenceList || [],
            env.GEMINI_BASE_URL,
            env.GEMINI_GATEWAY_TOKEN,
            env.GEMINI_API_KEY,
            base64Image
        );

        return json({ text: responseText });
    } catch (e: any) {
        console.error("Chat API Error:", e);
        return json({ error: e.message || "Failed to process chat request" }, { status: 500 });
    }
}
