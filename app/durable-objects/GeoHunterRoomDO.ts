import { DurableObject } from "cloudflare:workers";

interface Env {
    DB: D1Database;
}

export class GeoHunterRoomDO extends DurableObject {
    private sessions: Set<WebSocket>;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.sessions = new Set();
    }

    async fetch(request: Request) {
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        const { 0: client, 1: server } = new WebSocketPair();

        this.ctx.acceptWebSocket(server);
        this.sessions.add(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        // Broadcast the message to all other connected clients in this room
        for (const session of this.sessions) {
            if (session !== ws) {
                try {
                    session.send(message);
                } catch (err) {
                    // Ignore errors during broadcast, it usually means the connection was dropped
                }
            }
        }
    }

    webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        this.sessions.delete(ws);
    }

    webSocketError(ws: WebSocket, error: Error) {
        this.sessions.delete(ws);
    }
}
