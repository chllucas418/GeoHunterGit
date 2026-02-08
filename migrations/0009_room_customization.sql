-- Add customization options to rooms
ALTER TABLE rooms ADD COLUMN time_limit INTEGER DEFAULT 120;
ALTER TABLE rooms ADD COLUMN location_filter TEXT; -- JSON array of location IDs
