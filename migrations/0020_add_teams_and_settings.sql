-- Migration to add game modes, teams, and power-up mechanics

-- Step 1: Add game_mode to rooms
-- Allowed values: 'standard', 'teams', 'time_attack'
ALTER TABLE rooms ADD COLUMN game_mode TEXT DEFAULT 'standard';

-- Step 2: Add team and power-up columns to room_participants
ALTER TABLE room_participants ADD COLUMN team_id TEXT;
ALTER TABLE room_participants ADD COLUMN powerup_energy INTEGER DEFAULT 0;
