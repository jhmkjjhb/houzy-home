-- Fix supplier names: replace contact person name with company name
-- Run once in Supabase SQL Editor

UPDATE suppliers s
SET name = r.company_name
FROM registrations r
WHERE s.user_id = r.user_id
  AND r.type = 'supplier'
  AND r.status = 'approved'
  AND r.company_name IS NOT NULL
  AND r.company_name <> ''
  AND s.name IS DISTINCT FROM r.company_name;
