import { Form, Link, useActionData, useNavigation, redirect, useSubmit } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { useState, useEffect, useRef } from "react";
import { hashPassword, createSession, validatePassword } from "~/lib/auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const loginType = formData.get("loginType") as string;
    
    // Redirect Google Login to the central handler in login.tsx or implement here
    if (loginType === "google") {
        // For consistency, we'll handle Google Login exactly as in login.tsx
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
    const REQUIRED_DEV_KEY = env.DEVELOPER_REGISTRATION_KEY || "<REDACTED_DEV_KEY>";
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
            <div className="w-full max-w-md glass-panel p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-[-20%] right-[-20%] w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]" />
                <div className="absolute bottom-[-20%] left-[-20%] w-64 h-64 bg-purple-500/20 rounded-full blur-[80px]" />

                <div className="relative z-10">
                    <header className="mb-8 text-center">
                        <Link to="/" className="inline-block mb-6 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-white/60 transition-all">
                            ← Return to Base
                        </Link>
                        <h1 className="text-4xl font-black text-white tracking-tighter mb-2 text-glow">
                            Initialize Protocol
                        </h1>
                        <p className="text-sm text-blue-200/60 font-mono">Create your agent identity</p>
                    </header>

                    <Form method="post" className="space-y-5">
                        <input type="hidden" name="loginType" value="manual" />
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Codename</label>
                            <input name="displayName" type="text" required className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20" placeholder="Agent X" />
                        </div>

                        {!isDevMode && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Class</label>
                                    <select name="classGrade" className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all appearance-none cursor-pointer hover:bg-white/5" required>
                                        <option value="" disabled selected>--</option>
                                        <option value="2A">2A</option><option value="2B">2B</option><option value="2C">2C</option><option value="2D">2D</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Class No.</label>
                                    <input name="classNumber" type="number" min="1" max="40" required className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20" placeholder="#" />
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">{isDevMode ? "Any Email Address" : "Institutional Email"}</label>
                            <input name="email" type="email" required className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20" placeholder={isDevMode ? "dev@example.com" : "student@makopan.edu.hk"} />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-black tracking-widest text-blue-300 ml-4">Security Key</label>
                            <input name="password" type="password" required className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-sm text-white focus:border-blue-500 focus:bg-black/60 outline-none transition-all placeholder-white/20" placeholder="••••••••" />
                        </div>

                        <div className="pt-2">
                            <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-2xl border border-white/5 hover:border-blue-500/20 transition-all group">
                                <input 
                                    type="checkbox" 
                                    name="agreeToTerms" 
                                    id="agreeToTerms"
                                    className="mt-1 w-4 h-4 rounded border-white/10 bg-black/40 text-blue-600 focus:ring-blue-500 transition-all cursor-pointer"
                                    required
                                />
                                <label htmlFor="agreeToTerms" className="text-[11px] text-slate-400 leading-relaxed cursor-pointer group-hover:text-slate-200 transition-colors">
                                    I hereby acknowledge and irrevocably commit to the <Link to="/privacy" className="text-blue-400 underline decoration-blue-500/30 underline-offset-4 hover:text-white transition-colors">Global Legal Instrument</Link>, encompassing the ToS, Universal Privacy Policy, and EULA under International Digital Law.
                                </label>
                            </div>
                        </div>

                        <div className="pt-2">
                            <div className="flex justify-end mb-2">
                                <button type="button" onClick={() => setIsDevMode(!isDevMode)} className={`text-[9px] font-black uppercase tracking-widest border-b border-dashed ${isDevMode ? "text-yellow-400 border-yellow-400" : "text-white/20 border-white/20 hover:text-white/40"}`}>
                                    {isDevMode ? "⚠ Developer Override Active" : "Developer Access"}
                                </button>
                            </div>
                            {isDevMode && (
                                <div className="space-y-2 animate-in slide-in-from-top-2 fade-in">
                                    <input name="developerKey" type="password" className="w-full bg-yellow-400/10 border border-yellow-400/50 rounded-2xl px-6 py-3 text-sm text-yellow-200 focus:bg-yellow-400/20 outline-none transition-all placeholder-yellow-400/30" placeholder="Enter Override Key" />
                                </div>
                            )}
                        </div>

                        {actionData?.error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-bold rounded-2xl text-center">{actionData.error}</div>
                        )}

                        <button type="submit" disabled={isSubmitting} className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-blue-50 transition-all shadow-lg active:scale-[0.98] mt-2">
                            {isSubmitting ? "Establishing Uplink..." : "Activate Agent Profile"}
                        </button>
                    </Form>

                    <div className="mt-6 space-y-4">
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/10"></span></div>
                            <div className="relative flex justify-center text-[10px] uppercase font-black tracking-tighter"><span className="bg-[#0e121b] px-4 text-white/40">Secure Uplink</span></div>
                        </div>
                        <div ref={googleButtonRef} className="w-full"></div>
                    </div>

                    <footer className="mt-8 text-center">
                        <p className="text-xs text-white/40 font-bold">Already active? <Link to="/login" className="text-blue-400 hover:text-white transition-colors underline decoration-blue-500/30 underline-offset-4">Access Terminal</Link></p>
                    </footer>
                </div>
            </div>
        </div>
    );
}
