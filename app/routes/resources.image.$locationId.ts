import type { LoaderFunctionArgs } from "react-router";

export async function loader({ params, context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const { locationId } = params;

    if (!locationId) {
        return new Response("Missing location ID", { status: 400 });
    }

    // Cache content for 1 year (immutable) + Stale-While-Revalidate
    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    try {
        const validId = locationId.trim();
        const result = await db.prepare("SELECT image_url FROM locations WHERE id = ?").bind(validId).first<any>();

        if (!result || !result.image_url) {
            return new Response(`Image not found. ID: "${locationId}". Result: ${JSON.stringify(result)}`, { status: 404 });
        }

        const imageUrl = result.image_url;

        // Check if it's already a remote URL (http/https)
        if (imageUrl.startsWith("http")) {
            return Response.redirect(imageUrl, 301);
        }

        // Handle Base64 Data URI
        if (imageUrl.startsWith("data:")) {
            const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return new Response("Invalid image data", { status: 500 });
            }

            const contentType = matches[1];
            const base64Data = matches[2];

            // Decode Base64 without Buffer (Web Standard)
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            headers.set("Content-Type", contentType);
            headers.set("Content-Length", bytes.length.toString());

            return new Response(bytes, { headers });
        }

        return new Response("Unknown image format", { status: 500 });

    } catch (error) {
        console.error("Image loading error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}
