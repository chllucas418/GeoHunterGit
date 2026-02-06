import { createCookieSessionStorage, redirect } from "react-router";

/**
 * Authentication and Encryption Utilities for Cloudflare Workers
 * Uses Web Crypto API for password hashing and session management.
 */

export function validatePassword(password: string): { valid: boolean; error?: string } {
    if (password.length < 8) return { valid: false, error: "Password must be at least 8 characters long." };
    if (!/[A-Z]/.test(password)) return { valid: false, error: "Password must contain at least one uppercase letter." };
    if (!/[a-z]/.test(password)) return { valid: false, error: "Password must contain at least one lowercase letter." };
    if (!/[0-9]/.test(password)) return { valid: false, error: "Password must contain at least one number." };
    return { valid: true };
}

const ENCODER = new TextEncoder();

/**
 * Hashing a password with PBKDF2
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        ENCODER.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    const key = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        256
    );

    const hashBuffer = new Uint8Array(key);
    const combined = new Uint8Array(salt.length + hashBuffer.length);
    combined.set(salt);
    combined.set(hashBuffer, salt.length);

    return btoa(String.fromCharCode(...combined));
}

/**
 * Verifying a password against a hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const combined = new Uint8Array(
        atob(storedHash)
            .split("")
            .map((c) => c.charCodeAt(0))
    );
    const salt = combined.slice(0, 16);
    const hash = combined.slice(16);

    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        ENCODER.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        256
    );

    const derivedHash = new Uint8Array(derivedBits);
    if (derivedHash.length !== hash.length) return false;

    let result = 0;
    for (let i = 0; i < hash.length; i++) {
        result |= hash[i] ^ derivedHash[i];
    }
    return result === 0;
}

/**
 * Simple Session Management using signed cookies
 */
const sessionSecret = "geohunter-secret-key"; // In production, this should be an environment variable

export const sessionStorage = createCookieSessionStorage({
    cookie: {
        name: "__session",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secrets: [sessionSecret],
        secure: true, // Only sends over HTTPS
    },
});

// ... imports ...

export async function createSession(userId: string, role: string = 'student') {
    const session = await sessionStorage.getSession();
    session.set("userId", userId);
    session.set("role", role);
    return await sessionStorage.commitSession(session);
}

export async function getSession(request: Request) {
    return await sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getUserId(request: Request) {
    const session = await getSession(request);
    return session.get("userId") as string | undefined;
}

export async function getUserRole(request: Request) {
    const session = await getSession(request);
    return (session.get("role") as string) || "student";
}

export async function requireUser(request: Request) {
    const userId = await getUserId(request);
    if (!userId) {
        throw redirect("/login");
    }
    return userId;
}

export async function requireTeacher(request: Request) {
    const role = await getUserRole(request);
    if (role !== "teacher" && role !== "developer") {
        throw redirect("/"); // Or error page "Unauthorized"
    }
    return true;
}

export async function requireDeveloper(request: Request) {
    const role = await getUserRole(request);
    // Backward compatibility: check session "isDeveloper" OR role="developer"
    const session = await getSession(request);
    const isLegacyDev = session.get("isDeveloper");

    if (role !== "developer" && !isLegacyDev) {
        throw redirect("/login?developer=true");
    }
    return true;
}

export async function logout(request: Request) {
    const session = await getSession(request);
    return redirect("/", {
        headers: {
            "Set-Cookie": await sessionStorage.destroySession(session),
        },
    });
}

export async function isDeveloper(request: Request) {
    const role = await getUserRole(request);
    const session = await getSession(request);
    const isLegacyDev = session.get("isDeveloper");
    return role === "developer" || !!isLegacyDev;
}
