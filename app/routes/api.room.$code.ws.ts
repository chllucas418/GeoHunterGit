import { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
    const code = params.code;
    const upgradeHeader = request.headers.get("Upgrade");

    if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const env = context.cloudflare.env as any;
    const DO = env.GEOHUNTER_ROOM_DO;

    if (!DO) {
        return new Response("Durable Object binding missing", { status: 500 });
    }

    const id = DO.idFromName(code as string);
    const stub = DO.get(id);

    return stub.fetch(request);
}
