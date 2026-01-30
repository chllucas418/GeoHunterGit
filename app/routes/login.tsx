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
        if (!devPass || password !== devPass) {
            return { error: "Invalid developer password" };
        }
        // Dev session - using a special ID for dev
        const cookie = await createSession("developer-admin", true);
        return redirect("/", { headers: { "Set-Cookie": cookie } });
    }

    if (!email || !password) {
        return { error: "Email and password are required" };
    }

    const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();

    if (!user || !(await verifyPassword(password, user.password_hash))) {
        return { error: "Invalid email or password" };
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
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
                <header className="mb-8 text-center relative">
                    <Link to="/" className="absolute left-0 top-0 text-slate-500 hover:text-white text-xs transition-colors">
                        ← Home
                    </Link>
                    <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mt-8">
                        {isDevMode ? "Developer Access" : "Welcome Back"}
                    </h1>
                    <p className="text-slate-500 mt-2">
                        {isDevMode ? "Enter the system passkey." : "Log in to continue your hunt."}
                    </p>
                </header>

                <Form method="post" className="space-y-6">
                    <input type="hidden" name="loginType" value={isDevMode ? "developer" : "user"} />

                    {!isDevMode && (
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Email</label>
                            <input
                                name="email"
                                type="email"
                                required={!isDevMode}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                placeholder="alex@example.com"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">
                            {isDevMode ? "Developer Password" : "Password"}
                        </label>
                        <input
                            name="password"
                            type="password"
                            required
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="••••••••"
                        />
                    </div>

                    {actionData?.error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-xl">
                            {actionData.error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
                    >
                        {isSubmitting ? "Authenticating..." : (isDevMode ? "Access Terminal" : "Log In")}
                    </button>

                    <button
                        type="button"
                        onClick={() => setIsDevMode(!isDevMode)}
                        className="w-full text-slate-500 text-sm hover:text-slate-300 transition-colors"
                    >
                        {isDevMode ? "Back to User Login" : "Log in as a developer"}
                    </button>
                </Form>

                {!isDevMode && (
                    <footer className="mt-8 text-center text-sm text-slate-500">
                        Don't have an account?{" "}
                        <Link to="/register" className="text-blue-400 hover:underline">
                            Sign Up
                        </Link>
                    </footer>
                )}
            </div>
        </div>
    );
}
