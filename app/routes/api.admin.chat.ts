import type { ActionFunctionArgs } from "react-router";
import { requireTeacher } from "~/lib/auth.server";
import { chatWithGemini } from "~/lib/gemini.server";

export async function action({ request, context }: ActionFunctionArgs) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        await requireTeacher(request);
    } catch (e) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const env = context.cloudflare.env as any;
    
    try {
        const body = await request.json() as any;
        const { modelName, message, history, base64Image, location, evidenceList } = body;

        if (!message) {
            return Response.json({ error: "Message is required" }, { status: 400 });
        }

        const model = modelName || "gemini-3.5-flash"; // Default to 3.5 flash

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

        return Response.json({ text: responseText });
    } catch (e: any) {
        console.error("Chat API Error:", e);
        return Response.json({ error: e.message || "Failed to process chat request" }, { status: 500 });
    }
}
