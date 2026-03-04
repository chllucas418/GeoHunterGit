-- Add is_default_simulation column to locations table
ALTER TABLE locations ADD COLUMN is_default_simulation BOOLEAN DEFAULT 0;
