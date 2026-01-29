-- Initial Schema for GeoHunter D1 Backend

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  current_elo INTEGER DEFAULT 1000,
  total_games INTEGER DEFAULT 0,
  accuracy_avg REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  image_url TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  difficulty_rating INTEGER DEFAULT 5,
  quality_score INTEGER DEFAULT 0,
  verified_by_gemini BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  location_id TEXT REFERENCES locations(id),
  guess_lat REAL,
  guess_lng REAL,
  score INTEGER,
  ai_feedback TEXT, -- JSON string
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed some initial data for testing
INSERT INTO locations (id, image_url, lat, lng, difficulty_rating, quality_score, verified_by_gemini)
VALUES ('loc_hk_central', 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?q=80&w=1000&auto=format&fit=crop', 22.2797, 114.1717, 3, 90, 1);
