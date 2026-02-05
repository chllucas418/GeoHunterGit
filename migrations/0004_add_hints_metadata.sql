-- Migration number: 0004 	 2026-02-06T00:00:00.000Z
ALTER TABLE locations ADD COLUMN hints TEXT;
ALTER TABLE locations ADD COLUMN image_metadata TEXT; -- JSON: { photographer: string, date: string, etc. }
