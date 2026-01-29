/**
 * Safely parses the FIREBASE_CONFIG environment variable.
 * Handles cases where the value might be a JSON string, a literal "[object Object]" string,
 * or already an object (which can happen in some dev environments).
 */
export function getFirebaseConfig(env: any) {
    const raw = env.FIREBASE_CONFIG;

    if (!raw) {
        console.warn("FIREBASE_CONFIG is missing from environment.");
        return {};
    }

    if (typeof raw === 'object' && raw !== null) {
        return raw;
    }

    if (typeof raw === 'string') {
        if (raw.trim() === '[object Object]') {
            console.error("FIREBASE_CONFIG is set to the literal string '[object Object]'. This usually means the variable was set incorrectly.");
            return {};
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.error("Failed to parse FIREBASE_CONFIG as JSON:", e);
            return {};
        }
    }

    return {};
}
