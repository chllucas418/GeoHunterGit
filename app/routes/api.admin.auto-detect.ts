import type { ActionFunctionArgs } from "react-router";
import { requireTeacher } from "~/lib/auth.server";
import { autoDetectMapEvidence } from "~/lib/gemini.server";

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
        const { base64Image, imageUrl, location } = body;

        if ((!base64Image && !imageUrl) || !location || !location.lat || !location.lng) {
            return Response.json({ error: "Image (Base64 or URL) and valid location data are required" }, { status: 400 });
        }

        const evidence = await autoDetectMapEvidence(
            imageUrl || "", // Pass imageUrl if provided
            { lat: location.lat, lng: location.lng, name: location.name },
            env.GEMINI_BASE_URL,
            env.GEMINI_GATEWAY_TOKEN,
            env.GEMINI_API_KEY,
            base64Image // Pass base64Image if provided
        );

        return Response.json({ evidence });
    } catch (e: any) {
        console.error("Auto-Detect API Error:", e);
        return Response.json({ error: e.message || "Failed to auto-detect evidence" }, { status: 500 });
    }
}
