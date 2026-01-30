import { createCookieSessionStorage, redirect } from "react-router";

/**
 * Authentication and Encryption Utilities for Cloudflare Workers
 * Uses Web Crypto API for password hashing and session management.
 */

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

export async function createSession(userId: string) {
    const session = await sessionStorage.getSession();
    session.set("userId", userId);
    return await sessionStorage.commitSession(session);
}

export async function getUserId(request: Request) {
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    return session.get("userId") as string | undefined;
}

export async function requireUser(request: Request) {
    const userId = await getUserId(request);
    if (!userId) {
        throw redirect("/login");
    }
    return userId;
}

export async function logout(request: Request) {
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    return redirect("/login", {
        headers: {
            "Set-Cookie": await sessionStorage.destroySession(session),
        },
    });
}
