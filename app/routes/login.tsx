import { Form, Link, useActionData, useNavigation, redirect, useSubmit } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { verifyPassword, createSession } from "~/lib/auth.server";
import { useState, useEffect, useRef } from "react";

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const loginType = formData.get("loginType") as string;
    const googleCredential = formData.get("googleCredential") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (loginType === "google" && googleCredential) {
        try {
            // Verify Google ID Token
            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${googleCredential}`);
            if (!res.ok) throw new Error("Invalid Google token");
            
            const payload = await res.json() as any;
            const { email, name, picture, sub: googleId } = payload;

            if (!email) throw new Error("Email not provided by Google");

            // Parse name and class info
            // Format: (2A01) Chan Tai Man
            const nameRegex = /^\((?<class>\d[A-Za-z])(?<number>\d+)\)\s*(?<name>.+)$/i;
            const match = name.match(nameRegex);
            
            let classGrade = null;
            let classNumber = null;
            let displayName = name;

            if (match) {
                classGrade = match.groups.class.toUpperCase();
                classNumber = parseInt(match.groups.number);
                displayName = match.groups.name.trim();
            }

            // Check if user exists
            let user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();

            if (!user) {
                // Register new user
                const userId = `user_${googleId}`;
                await db.prepare(`
                    INSERT INTO users (id, email, password_hash, display_name, profile_picture_url, class_grade, class_number, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(userId, email, "GOOGLE_AUTH", displayName, picture, classGrade, classNumber, 'student').run();
                
                user = { id: userId, role: 'student' };
            } else {
                // Update existing user with Google info
                await db.prepare(`
                    UPDATE users SET 
                        display_name = COALESCE(?, display_name),
                        profile_picture_url = ?,
                        class_grade = COALESCE(?, class_grade),
                        class_number = COALESCE(?, class_number)
                    WHERE email = ?
                `).bind(displayName, picture, classGrade, classNumber, email).run();
            }

            const cookie = await createSession(user.id, user.role || 'student');
            return redirect("/", { headers: { "Set-Cookie": cookie } });
        } catch (err) {
            console.error("Google Login Error:", err);
            return { error: "Google Authentication failed. Please try again." };
        }
    }

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

    // Fix: Pass the actual role from the DB, default to 'student' if missing
    const role = user.role || 'student';
    const cookie = await createSession(user.id, role);

    return redirect("/", {
        headers: {
            "Set-Cookie": cookie,
        },
    });
}

export async function loader({ request, context }: any) {
    const env = context.cloudflare.env as any;
    return {
        googleDriveClientId: env.GOOGLE_DRIVE_CLIENT_ID
    };
}

export default function Login({ loaderData }: any) {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const submit = useSubmit();
    const isSubmitting = navigation.state === "submitting";
    const [isDevMode, setIsDevMode] = useState(false);
    const googleButtonRef = useRef<HTMLDivElement>(null);

    const { googleDriveClientId } = loaderData;

    useEffect(() => {
        const loadGoogleScript = () => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                const google = (window as any).google;
                if (google) {
                    google.accounts.id.initialize({
                        client_id: googleDriveClientId,
                        callback: handleGoogleResponse,
                    });
                    google.accounts.id.renderButton(googleButtonRef.current, {
                        type: 'standard',
                        theme: 'outline',
                        size: 'large',
                        width: '100%',
                        text: 'signin_with',
                        shape: 'rectangular',
                    });
                }
            };
            document.head.appendChild(script);
        };

        const handleGoogleResponse = (response: any) => {
            const formData = new FormData();
            formData.append('loginType', 'google');
            formData.append('googleCredential', response.credential);
            submit(formData, { method: 'post' });
        };

        loadGoogleScript();
    }, [submit]);

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
                            <>
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
                                
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Security Key</label>
                                    <input
                                        name="password"
                                        type="password"
                                        required={!isDevMode}
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </>
                        )}

                        {isDevMode && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Override Code</label>
                                <input
                                    name="password"
                                    type="password"
                                    required
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20"
                                    placeholder="••••••••"
                                />
                            </div>
                        )}

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

                    {!isDevMode && (
                        <div className="mt-6 space-y-4">
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/10"></span></div>
                                <div className="relative flex justify-center text-[10px] uppercase font-black tracking-tighter"><span className="bg-[#0c0f17] px-4 text-white/40">Secure Uplink</span></div>
                            </div>
                            
                            <div ref={googleButtonRef} className="w-full"></div>
                        </div>
                    )}

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
