import { Form, Link, useActionData, useNavigation, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { hashPassword, createSession, validatePassword } from "~/lib/auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const displayName = formData.get("displayName") as string;

    if (!email || !password) {
        return { error: "Email and password are required" };
    }

    const { valid, error } = validatePassword(password);
    if (!valid) {
        return { error };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Check if user exists
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
        return { error: "User already exists" };
    }

    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    try {
        await db.prepare(
            "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)"
        ).bind(userId, email, hashedPassword, displayName).run();

        const cookie = await createSession(userId);
        return redirect("/", {
            headers: {
                "Set-Cookie": cookie,
            },
        });
    } catch (e) {
        console.error("Signup error:", e);
        return { error: "Failed to create account" };
    }
}

export default function Register() {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
            <div className="w-full max-w-md glass-panel p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                {/* Background Decor */}
                <div className="absolute top-[-20%] right-[-20%] w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]" />
                <div className="absolute bottom-[-20%] left-[-20%] w-64 h-64 bg-purple-500/20 rounded-full blur-[80px]" />

                <div className="relative z-10">
                    <header className="mb-10 text-center">
                        <Link to="/" className="inline-block mb-6 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-white/60 transition-all">
                            ← Return to Base
                        </Link>
                        <h1 className="text-4xl font-black text-white tracking-tighter mb-2 text-glow">
                            Initialize Protocol
                        </h1>
                        <p className="text-sm text-blue-200/60 font-mono">Create your agent identity</p>
                    </header>

                    <Form method="post" className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Codename</label>
                            <input
                                name="displayName"
                                type="text"
                                required
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                placeholder="Agent X"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Comm Frequency</label>
                            <input
                                name="email"
                                type="email"
                                required
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                placeholder="agent@geohunter.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Security Key</label>
                            <input
                                name="password"
                                type="password"
                                required
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                placeholder="••••••••"
                            />
                        </div>

                        {actionData?.error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-bold rounded-2xl text-center">
                                {actionData.error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-blue-50 transition-all shadow-lg active:scale-[0.98] mt-4"
                        >
                            {isSubmitting ? "Establishing Uplink..." : "Activate Agent Profile"}
                        </button>
                    </Form>

                    <footer className="mt-8 text-center">
                        <p className="text-xs text-white/40 font-bold">
                            Already active?{" "}
                            <Link to="/login" className="text-blue-400 hover:text-white transition-colors underline decoration-blue-500/30 underline-offset-4">
                                Access Terminal
                            </Link>
                        </p>
                    </footer>
                </div>
            </div>
        </div>
    );
}
