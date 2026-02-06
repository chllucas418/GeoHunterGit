-- Migration 0006: Teacher Mode Schema

-- 1. Add Role to Users
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student';

-- 2. Map Sets (Collections of locations)
CREATE TABLE IF NOT EXISTS map_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Map Set Items (Join table)
CREATE TABLE IF NOT EXISTS map_set_items (
    set_id TEXT REFERENCES map_sets(id),
    location_id TEXT REFERENCES locations(id),
    order_index INTEGER NOT NULL,
    PRIMARY KEY (set_id, location_id)
);

-- 4. Rooms (Live Game Instances)
CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY, -- 6-digit code
    host_id TEXT REFERENCES users(id),
    map_set_id TEXT REFERENCES map_sets(id),
    status TEXT DEFAULT 'WAITING', -- WAITING, PLAYING, REVIEW, PODIUM
    current_index INTEGER DEFAULT 0, -- Current location index in the set
    round_start_time INTEGER, -- Timestamp (ms) when round started (for timer)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Room Participants (Students in the room)
CREATE TABLE IF NOT EXISTS room_participants (
    room_code TEXT REFERENCES rooms(code),
    user_id TEXT REFERENCES users(id),
    score INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_code, user_id)
);

-- 6. Room Guesses (Live answers)
CREATE TABLE IF NOT EXISTS room_guesses (
    room_code TEXT REFERENCES rooms(code),
    location_id TEXT REFERENCES locations(id),
    user_id TEXT REFERENCES users(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    score INTEGER NOT NULL,
    distance REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_code, location_id, user_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_code);
CREATE INDEX IF NOT EXISTS idx_room_guesses_room_loc ON room_guesses(room_code, location_id);
