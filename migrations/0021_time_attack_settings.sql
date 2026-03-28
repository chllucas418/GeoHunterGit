-- Migration 0021: Time Attack Customization Settings

-- Adds teacher-configurable parameters for Time Attack dynamic scoring
ALTER TABLE rooms ADD COLUMN ta_max_multiplier REAL DEFAULT 2.0;
ALTER TABLE rooms ADD COLUMN ta_min_multiplier REAL DEFAULT 0.5;
ALTER TABLE rooms ADD COLUMN ta_grace_period INTEGER DEFAULT 30;
