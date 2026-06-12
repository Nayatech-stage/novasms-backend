-- Add notes JSONB column to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]'::jsonb;
