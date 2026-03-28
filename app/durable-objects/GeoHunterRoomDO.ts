import { DurableObject } from "cloudflare:workers";

export class GeoHunterRoomDO extends DurableObject {
    env: any;

    constructor(state: DurableObjectState, env: any) {
        super(state, env);
        this.env = env;
    }

    async fetch(request: Request) {
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        // Cache the room code so the alarm knows which room to close in the database
        const url = new URL(request.url);
        const codeMatch = url.pathname.match(/\/api\/room\/([^/]+)/);
        if (codeMatch && codeMatch[1]) {
            await this.ctx.storage.put("roomCode", codeMatch[1]);
        }

        // Cancel the 30-min auto-close alarm since an active session joined
        await this.ctx.storage.deleteAlarm();

        const { 0: client, 1: server } = new WebSocketPair();

        this.ctx.acceptWebSocket(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        // Broadcast the message to all other connected clients in this room securely via context API
        const websockets = this.ctx.getWebSockets();
        for (const session of websockets) {
            if (session !== ws) {
                try {
                    session.send(message);
                } catch (err) {
                    // Ignore errors during broadcast, it usually means the connection was dropped
                }
            }
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        const activeClients = this.ctx.getWebSockets().filter(w => w !== ws);
        if (activeClients.length === 0) {
            // Auto-close 30 minutes after everyone disconnects
            await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
        }
    }

    async webSocketError(ws: WebSocket, error: Error) {
        const activeClients = this.ctx.getWebSockets().filter(w => w !== ws);
        if (activeClients.length === 0) {
            await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
        }
    }

    async alarm() {
        // Wakes up to officially close the inactive room
        const code = await this.ctx.storage.get<string>("roomCode");
        if (code && this.env.DB) {
            try {
                await this.env.DB.prepare("UPDATE rooms SET status = 'CLOSED' WHERE code = ?").bind(code).run();
            } catch (err) {
                console.error("Failed to auto-close inactive room DO:", err);
            }
        }
    }
}
