-- Migration 0017: Sync Locations Schema with Mass Add logic
-- Adding missing columns required by the 'save' intent in Mass Add API

ALTER TABLE locations ADD COLUMN name TEXT;
ALTER TABLE locations ADD COLUMN description TEXT;
ALTER TABLE locations ADD COLUMN photographer TEXT;
ALTER TABLE locations ADD COLUMN map_evidence TEXT; -- JSON string of evidence boxes/descriptions for quick recovery
