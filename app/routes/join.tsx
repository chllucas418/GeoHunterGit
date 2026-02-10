import { Form, useActionData, useNavigation, redirect } from "react-router";
import { requireUser } from "~/lib/auth.server";

export async function loader({ request }: any) {
    await requireUser(request);
    return null;
}

export async function action({ request, context }: any) {
    const userId = await requireUser(request);
    const formData = await request.formData();
    const code = formData.get("code") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Check if room exists
    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first();
    if (!room) {
        return { error: "Mission ID Invalid. Check clearance code." };
    }

    // Call internal join API or just insert here
    // Let's call the join logic directly or via fetch? 
    // Direct DB insert is faster/easer server-side

    try {
        await db.prepare(
            "INSERT INTO room_participants (room_code, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
        ).bind(code, userId).run();

        return redirect(`/live/${code}`);
    } catch (e) {
        return { error: "Failed to establish uplink." };
    }
}

export default function JoinGame() {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10 bg-slate-950">
            <div className="max-w-md w-full glass-panel p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-[-20%] right-[-20%] w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]" />

                <div className="relative z-10 text-center">
                    <h1 className="text-4xl font-black text-white tracking-tighter mb-2">
                        ENTER MISSION ID
                    </h1>
                    <p className="text-blue-200/60 font-mono text-sm mb-8">
                        Awaiting command authorization...
                    </p>

                    <Form method="post" className="space-y-6">
                        <input
                            name="code"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            required
                            className="w-full bg-black/40 border border-white/20 rounded-3xl px-6 py-6 text-center text-4xl font-black font-mono tracking-[0.5em] text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/10"
                            placeholder="000000"
                            autoComplete="off"
                        />

                        {actionData?.error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-bold rounded-2xl">
                                {actionData.error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-blue-50 transition-all shadow-lg active:scale-[0.98] mt-4"
                        >
                            {isSubmitting ? "Connecting..." : "Join Mission"}
                        </button>
                    </Form>

                    <Form action="/logout" method="post" className="mt-8">
                        <button type="submit" className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-red-400 transition-colors">
                            SIGN OUT OF TERMINAL
                        </button>
                    </Form>
                </div>
            </div>
        </div>
    );
}
