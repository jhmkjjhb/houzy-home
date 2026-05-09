-- Add installer notes field for installation scheduling
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installer_notes TEXT;
