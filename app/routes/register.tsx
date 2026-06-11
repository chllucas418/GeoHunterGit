import { Form, Link, useActionData, useNavigation, redirect, useSubmit } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { useState, useEffect, useRef } from "react";
import { hashPassword, createSession, validatePassword } from "~/lib/auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const loginType = formData.get("loginType") as string;

    if (loginType === "google") {
        const googleCredential = formData.get("googleCredential") as string;
        const env = context.cloudflare.env as any;
        const db = env.DB as D1Database;

        try {
            const agreeToTerms = formData.get("agreeToTerms") as string;
            if (agreeToTerms !== "on") {
                return { error: "You must agree to the Legal Instrument to proceed." };
            }

            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${googleCredential}`);
            if (!res.ok) throw new Error("Invalid Google token");
            const payload = await res.json() as any;
            const { email, name, picture, sub: googleId } = payload;

            const nameRegex = /^\((?<class>\d[A-Za-z])(?<number>\d+)\)\s*(?<name>.+)$/i;
            const match = name.match(nameRegex);
            let classGrade = null, classNumber = null, displayName = name;
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
            }
            const cookie = await createSession(user.id, user.role || 'student');
            return redirect("/", { headers: { "Set-Cookie": cookie } });
        } catch (err: any) {
            return { error: err.message || "Google Authentication failed." };
        }
    }

    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const displayName = formData.get("displayName") as string;
    const classGrade = formData.get("classGrade") as string;
    const classNumber = formData.get("classNumber") as string;
    const developerKey = formData.get("developerKey") as string;

    const agreeToTerms = formData.get("agreeToTerms") as string;

    if (!email || !password) {
        return { error: "Email and password are required" };
    }

    if (agreeToTerms !== "on") {
        return { error: "Submission blocked: You must accept the Legal Instrument protocol." };
    }

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;
    const REQUIRED_DEV_KEY = env.DEVELOPER_REGISTRATION_KEY || "";
    const isDevOverride = developerKey === REQUIRED_DEV_KEY;

    if (!isDevOverride) {
        if (!email.endsWith("@makopan.edu.hk")) {
            return { error: "Access Restricted: Institutional Email (@makopan.edu.hk) required." };
        }
        if (!classGrade || !classNumber) {
            return { error: "Class Information is required for student registration." };
        }
    }

    const { valid, error } = validatePassword(password);
    if (!valid) return { error };

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return { error: "User already exists" };

    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    try {
        await db.prepare(
            "INSERT INTO users (id, email, password_hash, display_name, class_grade, class_number) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(userId, email, hashedPassword, displayName, isDevOverride ? "DEV" : classGrade, isDevOverride ? 0 : parseInt(classNumber)).run();

        const role = isDevOverride ? 'developer' : 'student';
        const cookie = await createSession(userId, role);
        return redirect("/", { headers: { "Set-Cookie": cookie } });
    } catch (e) {
        return { error: "Failed to create account" };
    }
}

export async function loader({ request, context }: any) {
    const env = context.cloudflare.env as any;
    return {
        googleDriveClientId: env.GOOGLE_DRIVE_CLIENT_ID
    };
}

export default function Register({ loaderData }: any) {
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
                        text: 'signup_with',
                        shape: 'rectangular',
                    });
                }
            };
            document.head.appendChild(script);
        };

        const handleGoogleResponse = (response: any) => {
            const agreeToTerms = (document.querySelector('input[name="agreeToTerms"]') as HTMLInputElement)?.checked;
            if (!agreeToTerms) {
                alert("You must agree to the Legal Instrument before signing up with Google.");
                return;
            }
            const formData = new FormData();
            formData.append('loginType', 'google');
            formData.append('googleCredential', response.credential);
            formData.append('agreeToTerms', 'on');
            submit(formData, { method: 'post' });
        };
        loadGoogleScript();
    }, [submit]);

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                        <span className="text-[9px] font-mono text-teal uppercase tracking-[0.4em]">Secure Channel</span>
                    </div>
                    <h1 className="font-heading text-4xl font-black text-cream tracking-tight mb-2">Initialize Protocol</h1>
                    <p className="text-sm font-body text-stone-light">Create your agent identity</p>
                </div>

                {/* Terminal card */}
                <div className="bg-[#0a1210] border border-brass/20 rounded-sm overflow-hidden">
                    <div className="px-4 py-3 bg-[#0e1a14] border-b border-brass/10 flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rust/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-teal/60" />
                        <span className="text-[9px] font-mono text-stone/40 uppercase tracking-widest ml-2">register.exe</span>
                    </div>

                    <div className="p-8">
                        <Form method="post" className="space-y-5">
                            <input type="hidden" name="loginType" value="manual" />

                            <div>
                                <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Codename</label>
                                <input
                                    name="displayName"
                                    type="text"
                                    required
                                    className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                    placeholder="Agent X"
                                />
                            </div>

                            {!isDevMode && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Class</label>
                                        <select
                                            name="classGrade"
                                            className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none appearance-none cursor-pointer"
                                            required
                                        >
                                            <option value="" disabled selected>--</option>
                                            <option value="2A">2A</option>
                                            <option value="2B">2B</option>
                                            <option value="2C">2C</option>
                                            <option value="2D">2D</option>
                                            <option value="3A">3A</option>
                                            <option value="3B">3B</option>
                                            <option value="3C">3C</option>
                                            <option value="3D">3D</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Class No.</label>
                                        <input
                                            name="classNumber"
                                            type="number"
                                            min="1"
                                            max="40"
                                            required
                                            className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                            placeholder="#"
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">
                                    {isDevMode ? "Email Address" : "Institutional Email"}
                                </label>
                                <input
                                    name="email"
                                    type="email"
                                    required
                                    className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                    placeholder={isDevMode ? "dev@example.com" : "student@makopan.edu.hk"}
                                />
                            </div>

                            <div>
                                <label className="block text-[9px] font-mono text-stone/50 uppercase tracking-widest mb-2">Security Key</label>
                                <input
                                    name="password"
                                    type="password"
                                    required
                                    className="w-full bg-[#0e1a14] border border-brass/10 px-4 py-3 text-cream text-sm font-mono focus:border-brass focus:outline-none placeholder-stone/30"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div className="flex items-start gap-3 p-4 bg-brass/5 border border-brass/10 rounded-sm">
                                <input
                                    type="checkbox"
                                    name="agreeToTerms"
                                    id="agreeToTerms"
                                    className="mt-0.5 w-4 h-4 rounded border-brass/30 bg-[#0e1a14] text-brass focus:ring-brass cursor-pointer"
                                    required
                                />
                                <label htmlFor="agreeToTerms" className="text-[10px] text-stone-light leading-relaxed cursor-pointer">
                                    I acknowledge the <Link to="/privacy" className="text-brass hover:text-cream transition-colors underline decoration-brass/30 underline-offset-2">Legal Instrument</Link> and commit to the protocol.
                                </label>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsDevMode(!isDevMode)}
                                    className={`text-[9px] font-mono uppercase tracking-widest border-b border-dashed pb-0.5 ${
                                        isDevMode ? "text-amber border-amber" : "text-stone/30 border-stone/30 hover:text-stone/60"
                                    }`}
                                >
                                    {isDevMode ? "⚠ Developer Override Active" : "Developer Access →"}
                                </button>
                                {isDevMode && (
                                    <div className="mt-3 animate-in slide-in-from-top-2 fade-in">
                                        <input
                                            name="developerKey"
                                            type="password"
                                            className="w-full bg-amber/10 border border-amber/30 px-4 py-3 text-amber text-sm font-mono focus:border-amber focus:outline-none placeholder-amber/30"
                                            placeholder="Enter Override Key"
                                        />
                                    </div>
                                )}
                            </div>

                            {actionData?.error && (
                                <div className="p-3 bg-rust/10 border border-rust/20 text-rust text-xs font-mono text-center">
                                    {actionData.error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-4 bg-brass text-charcoal font-mono text-sm font-black uppercase tracking-widest hover:bg-brass/90 transition-all mt-4"
                            >
                                {isSubmitting ? "Establishing Uplink..." : "Activate Agent Profile"}
                            </button>
                        </Form>

                        <div className="mt-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="flex-1 h-px bg-brass/10" />
                                <span className="text-[9px] font-mono text-stone/30 uppercase tracking-widest">Secure Uplink</span>
                                <div className="flex-1 h-px bg-brass/10" />
                            </div>
                            <div ref={googleButtonRef} className="w-full"></div>
                        </div>

                        <div className="mt-6 pt-6 border-t border-brass/10 text-center">
                            <p className="text-[10px] text-stone/40">
                                Already active?{" "}
                                <Link to="/login" className="text-brass hover:text-cream transition-colors">Access Terminal</Link>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="text-center mt-8">
                    <Link to="/" className="text-[9px] font-mono text-stone/30 hover:text-stone/60 uppercase tracking-widest transition-colors">
                        ← Return to Base
                    </Link>
                </div>
            </div>
        </div>
    );
}