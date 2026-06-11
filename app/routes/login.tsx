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
            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${googleCredential}`);
            if (!res.ok) throw new Error("Invalid Google token");

            const payload = await res.json() as any;
            const { email, name, picture, sub: googleId } = payload;

            if (!email) throw new Error("Email not provided by Google");

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

            let user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();

            if (!user) {
                const userId = `user_${googleId}`;
                await db.prepare(`
                    INSERT INTO users (id, email, password_hash, display_name, profile_picture_url, class_grade, class_number, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(userId, email, "GOOGLE_AUTH", displayName, picture, classGrade, classNumber, 'student').run();

                user = { id: userId, role: 'student' };
            } else {
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

    let isValid = false;
    if (user) {
        isValid = await verifyPassword(password, user.password_hash);
    }

    if (!user || !isValid) {
        return { error: "Authentication Failed: Invalid credentials." };
    }

    const role = user.role || 'student';
    const cookie = await createSession(user.id, role);

    return redirect("/", { headers: { "Set-Cookie": cookie } });
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
            <div className="w-full max-w-md">
                {/* Logo area */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-3 mb-6">
                        <div className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                        <span className="text-[9px] font-mono text-teal uppercase tracking-[0.4em]">Secure Channel</span>
                    </div>
                    <h1 className="font-heading text-5xl font-black text-cream tracking-tight mb-2">GeoHunter</h1>
                    <p className="text-sm font-body text-stone-light">
                        {isDevMode ? "Override Protocol" : "Agent Authentication"}
                    </p>
                </div>

                {/* Terminal-style card */}
                <div className="bg-[#0a1210] border border-brass/20 rounded-sm overflow-hidden">
                    {/* Terminal header */}
                    <div className="px-4 py-3 bg-[#0e1a14] border-b border-brass/10 flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rust/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-teal/60" />
                        <span className="text-[9px] font-mono text-stone/40 uppercase tracking-widest ml-2">auth.exe</span>
                    </div>

                    <div className="p-8">
                        <Form method="post" className="space-y-6">
                            <input type="hidden" name="loginType" value={isDevMode ? "developer" : "user"} />

                            {!isDevMode && (
                                <>
                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Email</label>
                                        <input
                                            name="email"
                                            type="email"
                                            required
                                            className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                            placeholder="agent@geohunter.hk"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Password</label>
                                        <input
                                            name="password"
                                            type="password"
                                            required
                                            className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </>
                            )}

                            {isDevMode && (
                                <div>
                                    <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Override Code</label>
                                    <input
                                        name="password"
                                        type="password"
                                        required
                                        className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none"
                                        placeholder="Enter override code"
                                    />
                                </div>
                            )}

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
                                {isSubmitting ? "Verifying..." : (isDevMode ? "Execute Override" : "Authenticate")}
                            </button>
                        </Form>

                        {!isDevMode && (
                            <div className="mt-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="flex-1 h-px bg-brass/10" />
                                    <span className="text-[9px] font-mono text-stone/30 uppercase tracking-widest">Secure Uplink</span>
                                    <div className="flex-1 h-px bg-brass/10" />
                                </div>
                                <div ref={googleButtonRef} className="w-full"></div>
                            </div>
                        )}

                        <div className="mt-8 pt-6 border-t border-brass/10 text-center space-y-4">
                            {!isDevMode && (
                                <p className="text-xs text-stone/50">
                                    No clearance?{" "}
                                    <Link to="/register" className="text-brass hover:text-cream transition-colors">
                                        Register Agent
                                    </Link>
                                </p>
                            )}

                            <button
                                type="button"
                                onClick={() => setIsDevMode(!isDevMode)}
                                className="text-[9px] font-mono text-stone/30 hover:text-stone/60 uppercase tracking-widest transition-colors"
                            >
                                {isDevMode ? "← Cancel Override" : "Developer Mode →"}
                            </button>
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