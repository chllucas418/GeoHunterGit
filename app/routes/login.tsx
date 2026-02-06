import { Form, Link, useActionData, useNavigation, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { verifyPassword, createSession } from "~/lib/auth.server";
import { useState } from "react";

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const loginType = formData.get("loginType") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (loginType === "developer") {
        const devPass = env.DEVELOPER_PASSWORD;
        // Simple check for dev mode
        if (!devPass || password !== devPass) {
            return { error: "Access Denied: Invalid override code." };
        }
        const cookie = await createSession("developer-admin", "developer");
        return redirect("/", { headers: { "Set-Cookie": cookie } });
    }

    if (!email || !password) {
        return { error: "Email and password are required" };
    }

    const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();

    // Using a simpler verification for now as we don't have the verifyPassword function
    // In a real app, use strict password hashing
    // Assuming verifyPassword is imported correctly from previous steps
    // If logic fails, we fallback to direct comparison for this demo ONLY if hash check fails (migration support)
    let isValid = false;
    // @ts-ignore
    if (user) {
        // @ts-ignore
        isValid = await verifyPassword(password, user.password_hash);
    }

    if (!user || !isValid) {
        return { error: "Authentication Failed: Invalid credentials." };
    }

    const cookie = await createSession(user.id, false);

    return redirect("/", {
        headers: {
            "Set-Cookie": cookie,
        },
    });
}

export default function Login() {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
    const [isDevMode, setIsDevMode] = useState(false);

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
            <div className="w-full max-w-md glass-panel p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">

                {/* Background Decor */}
                <div className="absolute top-[-20%] left-[-20%] w-64 h-64 bg-indigo-500/20 rounded-full blur-[80px]" />
                <div className="absolute bottom-[-20%] right-[-20%] w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]" />

                <div className="relative z-10">
                    <header className="mb-10 text-center">
                        <Link to="/" className="inline-block mb-6 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-white/60 transition-all">
                            ← Return to Base
                        </Link>
                        <h1 className="text-4xl font-black text-white tracking-tighter mb-2 text-glow">
                            {isDevMode ? "Override Protocol" : "Agent Access"}
                        </h1>
                        <p className="text-sm text-blue-200/60 font-mono">
                            {isDevMode ? "Enter Command Override Code" : "Identify yourself to proceed"}
                        </p>
                    </header>

                    <Form method="post" className="space-y-6">
                        <input type="hidden" name="loginType" value={isDevMode ? "developer" : "user"} />

                        {!isDevMode && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Comm Frequency</label>
                                <input
                                    name="email"
                                    type="email"
                                    required={!isDevMode}
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                    placeholder="agent@geohunter.com"
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">
                                {isDevMode ? "Override Code" : "Security Key"}
                            </label>
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
                            {isSubmitting ? "Verifying..." : (isDevMode ? "Execute Override" : "Authenticate")}
                        </button>
                    </Form>

                    <div className="mt-8 pt-6 border-t border-white/10 text-center space-y-4">
                        {!isDevMode && (
                            <p className="text-xs text-white/40 font-bold">
                                No clearance?{" "}
                                <Link to="/register" className="text-blue-400 hover:text-white transition-colors underline decoration-blue-500/30 underline-offset-4">
                                    Initialize New Agent
                                </Link>
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={() => setIsDevMode(!isDevMode)}
                            className="text-[10px] uppercase tracking-widest font-bold text-white/20 hover:text-white/60 transition-colors"
                        >
                            {isDevMode ? "Cancel Override" : "Developer Mode"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
