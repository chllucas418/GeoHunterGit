import { Form, useActionData, useNavigation, redirect, Link } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { hashPassword, requireDeveloper } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);

    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const displayName = formData.get("displayName") as string;

    if (!email || !password || !displayName) {
        return { error: "All fields are required" };
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
            "INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, 'teacher')"
        ).bind(userId, email, hashedPassword, displayName).run();

        return { success: true, message: `Teacher account for ${displayName} created successfully!` };
    } catch (e) {
        console.error("Create Teacher error:", e);
        return { error: "Failed to create account" };
    }
}

export default function CreateTeacher() {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    return (
        <div className="min-h-screen bg-slate-950 text-white p-8">
            <header className="max-w-4xl mx-auto mb-12 flex items-center justify-between">
                <div>
                    <Link to="/admin" className="text-xs uppercase tracking-widest text-slate-500 hover:text-blue-400 transition-colors mb-2 block">
                        ← Back to Admin Command
                    </Link>
                    <h1 className="text-3xl font-black tracking-tighter">Provision Teacher Agent</h1>
                    <p className="text-slate-400 font-mono text-sm">Create a restricted access account for classroom management.</p>
                </div>
            </header>

            <div className="max-w-md mx-auto glass-panel p-8 rounded-2xl border border-white/10">
                <Form method="post" className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs uppercase font-bold text-slate-400 ml-1">Display Name</label>
                        <input
                            name="displayName"
                            type="text"
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                            placeholder="Mr. Anderson"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs uppercase font-bold text-slate-400 ml-1">Email Address</label>
                        <input
                            name="email"
                            type="email"
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                            placeholder="teacher@school.edu"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs uppercase font-bold text-slate-400 ml-1">Initial Password</label>
                        <input
                            name="password"
                            type="password"
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                            placeholder="••••••••"
                        />
                    </div>

                    {actionData?.error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-bold rounded-xl text-center">
                            {actionData.error}
                        </div>
                    )}

                    {actionData?.success && (
                        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-300 text-xs font-bold rounded-xl text-center">
                            {actionData.message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-[0.98]"
                    >
                        {isSubmitting ? "Provisioning..." : "Create Teacher Account"}
                    </button>
                </Form>
            </div>
        </div>
    );
}
