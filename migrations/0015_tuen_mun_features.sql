-- Migration for Tuen Mun Localized Features & Teacher Tools
-- Execute this manually on the Cloudflare D1 dashboard

-- 1. Updates to the users table
ALTER TABLE users ADD COLUMN elo INTEGER DEFAULT 1200;
ALTER TABLE users ADD COLUMN games_played INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN total_score INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN total_distance REAL DEFAULT 0;
-- SQLite does not have an array type, so we use TEXT for JSON/string representation of titles
ALTER TABLE users ADD COLUMN titles TEXT; 

-- 2. Updates to the rooms table
-- is_paused is a boolean flag (0=false, 1=true) allowing the teacher to freeze the game
ALTER TABLE rooms ADD COLUMN is_paused INTEGER DEFAULT 0;
-- curriculum_focus allows the teacher to select a focus (e.g. Architecture) for AI hint adjustment
ALTER TABLE rooms ADD COLUMN curriculum_focus TEXT;
-- has_guided_playthrough toggle (0=false, 1=true) determines if tutorial plays before round 1
ALTER TABLE rooms ADD COLUMN has_guided_playthrough INTEGER DEFAULT 0;
