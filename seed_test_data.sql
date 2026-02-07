-- Seed Data for Testing
INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role) VALUES 
('teacher_1', 'teacher@example.com', 'hash', 'Teacher Tom', 'teacher'),
('student_1', 'student@example.com', 'hash', 'Student Sam', 'student');

INSERT OR IGNORE INTO locations (id, image_url, lat, lng, difficulty_rating, quality_score, verified_by_gemini) VALUES 
('loc_1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Hong_Kong_Skyline_Restitch_-_Dec_2007.jpg/1200px-Hong_Kong_Skyline_Restitch_-_Dec_2007.jpg', 22.2797, 114.1717, 5, 100, 1);

INSERT OR IGNORE INTO map_sets (id, name, description, created_by) VALUES 
('set_1', 'Demo Set', 'A test set', 'teacher_1');

INSERT OR IGNORE INTO map_set_items (set_id, location_id, order_index) VALUES 
('set_1', 'loc_1', 0);

INSERT OR IGNORE INTO rooms (code, host_id, map_set_id, status, current_index, round_start_time) VALUES 
('123456', 'teacher_1', 'set_1', 'PLAYING', 0, 1700000000000);

INSERT OR IGNORE INTO room_participants (room_code, user_id, score) VALUES 
('123456', 'student_1', 0);
