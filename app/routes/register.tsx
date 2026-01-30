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
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
                <header className="mb-8 relative">
                    <Link to="/" className="absolute left-0 top-0 text-slate-500 hover:text-white text-xs transition-colors">
                        ← Home
                    </Link>
                    <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mt-8">
                        Join GeoHunter
                    </h1>
                    <p className="text-slate-500 mt-2">Create your account to start hunting.</p>
                </header>

                <Form method="post" className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Display Name</label>
                        <input
                            name="displayName"
                            type="text"
                            required
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="Alex Smith"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Email</label>
                        <input
                            name="email"
                            type="email"
                            required
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="alex@example.com"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Password</label>
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

                    {actionData?.success && (
                        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-xl">
                            {actionData.message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
                    >
                        {isSubmitting ? "Creating Account..." : "Sign Up"}
                    </button>
                </Form>

                <footer className="mt-8 text-center text-sm text-slate-500">
                    Already have an account?{" "}
                    <Link to="/login" className="text-blue-400 hover:underline">
                        Log In
                    </Link>
                </footer>
            </div>
        </div>
    );
}
