-- Migration number: 0003 	 2026-02-03T00:00:00.000Z
CREATE TABLE map_evidence (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    bounding_box TEXT NOT NULL, -- JSON: {x, y, width, height} (percentages)
    description TEXT NOT NULL,
    created_by_user_id TEXT, -- NULL if developer/system
    is_verified BOOLEAN DEFAULT FALSE,
    confidence_score INTEGER DEFAULT 0, -- For AI auto-verified items
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX idx_evidence_location ON map_evidence(location_id);
