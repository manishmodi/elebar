-- Phase 0 groundwork: one-record-per-rider-per-day
--
-- 1) Dedupe: for each (rider_id, day) with multiple rows, keep the LATEST row
--    (max created_at, tiebreak max id). Verified against prod 2026-07-10:
--    5 attendance pairs (guard re-entries; later row is the correction) and
--    1 daily_logs pair (id 476 = abandoned morning entry with phantom 1771
--    cash_check; id 479 = completed evening entry). cash_collections has no dups.
--    Rule-based (not hardcoded ids) so it is idempotent and safe on re-run.
--
-- 2) Unique indexes: enforce the invariant all app logic already assumes.
--
-- Run order at ship (migration-first): this file against prod Neon BEFORE
-- pushing code whose boot ensure* expects the indexes to be creatable.

BEGIN;

DELETE FROM attendance a
USING attendance b
WHERE a.rider_id = b.rider_id
  AND a.date = b.date
  AND (a.created_at, a.id) < (b.created_at, b.id);

DELETE FROM daily_logs a
USING daily_logs b
WHERE a.rider_id = b.rider_id
  AND a.english_date = b.english_date
  AND (a.created_at, a.id) < (b.created_at, b.id);

DELETE FROM cash_collections a
USING cash_collections b
WHERE a.rider_id = b.rider_id
  AND a.english_date = b.english_date
  AND (a.submitted_at, a.id) < (b.submitted_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_rider_date_unique
  ON attendance (rider_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_rider_english_date_unique
  ON daily_logs (rider_id, english_date);

CREATE UNIQUE INDEX IF NOT EXISTS cash_collections_rider_english_date_unique
  ON cash_collections (rider_id, english_date);

COMMIT;
