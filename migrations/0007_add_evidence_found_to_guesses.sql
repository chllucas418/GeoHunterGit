-- Add missing columns for AI Evidence
ALTER TABLE room_guesses ADD COLUMN evidence_found TEXT;
ALTER TABLE room_guesses ADD COLUMN ai_feedback TEXT;
