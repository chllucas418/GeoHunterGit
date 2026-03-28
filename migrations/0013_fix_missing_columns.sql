-- Fix missing columns from previous skipped/failed migrations
-- All columns were already present from migrations 0006 and 0009.
-- This migration is now a no-op for clean installs.
SELECT 1;
