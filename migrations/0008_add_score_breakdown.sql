-- Add breakdown columns for score analytics
ALTER TABLE room_guesses ADD COLUMN distance_score INTEGER DEFAULT 0;
ALTER TABLE room_guesses ADD COLUMN evidence_score INTEGER DEFAULT 0;
