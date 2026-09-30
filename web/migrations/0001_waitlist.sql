-- Waitlist sign-ups from the landing page. One row per email.
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('backer', 'builder')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
