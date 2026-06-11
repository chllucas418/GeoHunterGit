import { Form, useActionData, useNavigation, redirect, Link } from "react-router";
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

    const room = await db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first();
    if (!room) {
        return { error: "Mission ID Invalid. Check clearance code." };
    }

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
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-3 mb-6">
                        <div className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                        <span className="text-[9px] font-mono text-teal uppercase tracking-[0.4em]">Secure Channel</span>
                    </div>
                    <h1 className="font-heading text-4xl font-black text-cream tracking-tight mb-2">Enter Mission</h1>
                    <p className="text-sm font-body text-stone-light">Awaiting command authorization...</p>
                </div>

                {/* Terminal card */}
                <div className="bg-[#0a1210] border border-brass/20 rounded-sm overflow-hidden">
                    <div className="px-4 py-3 bg-[#0e1a14] border-b border-brass/10 flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rust/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-teal/60" />
                        <span className="text-[9px] font-mono text-stone/40 uppercase tracking-widest ml-2">mission.exe</span>
                    </div>

                    <div className="p-8">
                        <Form method="post" className="space-y-6">
                            <div>
                                <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-3 text-center">Mission ID</label>
                                <input
                                    name="code"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    required
                                    className="w-full bg-[#0e1a14] border border-brass/20 px-6 py-5 text-center text-3xl font-mono font-black tracking-[0.3em] text-brass focus:border-brass focus:outline-none placeholder-stone/20"
                                    placeholder="000000"
                                    autoComplete="off"
                                />
                            </div>

                            {actionData?.error && (
                                <div className="p-3 bg-rust/10 border border-rust/20 text-rust text-xs font-mono text-center">
                                    {actionData.error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-4 bg-brass text-charcoal font-mono text-sm font-black uppercase tracking-widest hover:bg-brass/90 transition-all"
                            >
                                {isSubmitting ? "Connecting..." : "Join Mission"}
                            </button>
                        </Form>

                        <div className="mt-8 pt-6 border-t border-brass/10 text-center">
                            <Form action="/logout" method="post">
                                <button type="submit" className="text-[9px] font-mono text-stone/30 hover:text-rust uppercase tracking-widest transition-colors">
                                    Disconnect Terminal
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>

                {/* Back link */}
                <div className="text-center mt-8">
                    <Link to="/" className="text-[9px] font-mono text-stone/30 hover:text-stone/60 uppercase tracking-widest transition-colors">
                        ← Return to Base
                    </Link>
                </div>
            </div>
        </div>
    );
}