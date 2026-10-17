/*
# Create detections table for hate speech detection history

1. New Tables
- `detections`
  - `id` (uuid, primary key)
  - `statement` (text, not null) — the text the user submitted for analysis
  - `is_hateful` (boolean, not null) — whether the statement was detected as hateful
  - `confidence` (numeric, not null) — confidence score from 0 to 100
  - `categories` (text[]) — detected hate categories (e.g. racial, gender, religious)
  - `severity` (text, not null) — severity level: none, low, moderate, high, severe
  - `explanation` (text) — human-readable explanation of the detection result
  - `flagged_terms` (text[]) — specific terms that triggered the detection
  - `created_at` (timestamptz, default now())

2. Security
- Enable RLS on `detections`.
- Allow anon + authenticated full CRUD — this is a single-tenant public app with no sign-in.
- All data is intentionally shared/public so anyone can see detection history.
*/

CREATE TABLE IF NOT EXISTS detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement text NOT NULL,
  is_hateful boolean NOT NULL,
  confidence numeric(5,2) NOT NULL,
  categories text[] DEFAULT '{}',
  severity text NOT NULL DEFAULT 'none',
  explanation text,
  flagged_terms text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_detections" ON detections;
CREATE POLICY "anon_select_detections" ON detections FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_detections" ON detections;
CREATE POLICY "anon_insert_detections" ON detections FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_detections" ON detections;
CREATE POLICY "anon_update_detections" ON detections FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_detections" ON detections;
CREATE POLICY "anon_delete_detections" ON detections FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_detections_created_at ON detections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_is_hateful ON detections (is_hateful);
