-- Migration: Add hint_interval to rooms table
ALTER TABLE rooms ADD COLUMN hint_interval INTEGER DEFAULT 30;
