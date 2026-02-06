-- Migration to add class info to users table

ALTER TABLE users ADD COLUMN class_grade TEXT;
ALTER TABLE users ADD COLUMN class_number INTEGER;
