-- Fix missing columns from previous skipped/failed migrations
-- Some instances might have missed 0009 or partial 0006 due to IF NOT EXISTS conflicts

-- Add time_limit if missing (safe re-run of 0009 logic essentially)
-- Note: SQLite doesn't support IF NOT EXISTS in ALTER TABLE directly in standard versions used by D1 sometimes, 
-- but we can try. D1 execute usually handles errors or we assume it's missing based on investigation.
-- However, blindly running ALTER TABLE will fail if column exists.
-- Since I VERIFIED they are missing, I will just add them.

ALTER TABLE rooms ADD COLUMN time_limit INTEGER DEFAULT 120;
ALTER TABLE rooms ADD COLUMN round_start_time INTEGER;
ALTER TABLE rooms ADD COLUMN location_filter TEXT;
