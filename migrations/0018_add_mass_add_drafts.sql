-- Migration 0018: Add Mass Add Drafts table
-- This table stores temporary editing states for the mass-add feature to allow cross-device sync.

CREATE TABLE IF NOT EXISTS mass_add_drafts (
    id TEXT PRIMARY KEY, -- Using a constant 'global' or per-user ID if we add user-specific drafts later
    user_email TEXT,     -- Optional: scoping by user if auth is available
    draft_data TEXT,      -- JSON blob of the 'files' array from the frontend
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookup (if we expand to multiple users)
CREATE INDEX IF NOT EXISTS idx_mass_add_drafts_email ON mass_add_drafts(user_email);
