-- Migration to make password_hash nullable for Google users
-- D1 doesn't support ALTER COLUMN ... DROP NOT NULL easily, 
-- but we can recreate the table or just rely on the fact that existing users have it.
-- Actually, SQLite ALTER TABLE is limited.
-- We'll try to just ignore NOT NULL if we can, or migrate to a new table.
-- However, for the sake of simplicity and safety in this environment:
-- We will check if we can just use an empty string or something.
-- But the better way is a proper migration.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT, -- Made nullable
  display_name TEXT,
  current_elo INTEGER DEFAULT 1000,
  total_games INTEGER DEFAULT 0,
  accuracy_avg REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  profile_picture_url TEXT,
  class_grade TEXT,
  class_number INTEGER,
  role TEXT DEFAULT 'student'
);

INSERT INTO users_new (id, email, password_hash, display_name, current_elo, total_games, accuracy_avg, created_at, profile_picture_url, class_grade, class_number)
SELECT id, email, password_hash, display_name, current_elo, total_games, accuracy_avg, created_at, profile_picture_url, class_grade, class_number FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
