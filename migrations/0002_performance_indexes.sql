-- Performance Indexes for GeoHunter v2

-- Speed up home page sorting
CREATE INDEX IF NOT EXISTS idx_locations_created_at ON locations(created_at DESC);

-- Speed up leaderboard ranking
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(current_elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_games ON users(total_games DESC);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Speed up profile history lookups
CREATE INDEX IF NOT EXISTS idx_game_history_user ON game_sessions(user_id, timestamp DESC);

-- Speed up location stats aggregation (future proofing)
CREATE INDEX IF NOT EXISTS idx_game_history_location ON game_sessions(location_id);
