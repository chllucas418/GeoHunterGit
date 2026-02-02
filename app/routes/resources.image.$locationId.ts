import type { LoaderFunctionArgs } from "react-router";
// @ts-expect-error Cloudflare Workers support node:buffer
import { Buffer } from "node:buffer";

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
        const result = await db.prepare("SELECT image_url FROM locations WHERE id = ?").bind(locationId).first<any>();

        if (!result || !result.image_url) {
            return new Response("Image not found", { status: 404 });
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
            const buffer = Buffer.from(matches[2], "base64");

            headers.set("Content-Type", contentType);
            headers.set("Content-Length", buffer.length.toString());

            return new Response(buffer, { headers });
        }

        return new Response("Unknown image format", { status: 500 });

    } catch (error) {
        console.error("Image loading error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}
