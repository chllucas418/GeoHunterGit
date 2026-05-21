-- Clean up the 'Real-time analysis active.' static placeholder string from map_evidence table
UPDATE map_evidence SET ai_analysis = NULL WHERE ai_analysis = 'Real-time analysis active.';
