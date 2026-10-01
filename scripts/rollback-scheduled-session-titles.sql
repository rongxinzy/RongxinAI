-- Close the app and open its zhiyuan.sqlite with a SQLite client.
-- Run this whole file after reverting the title-normalization code.
-- Only journaled, untouched titles are restored; new sessions and later renames
-- (including rename-away-and-back) are preserved. No sessions/messages are removed.
-- Keep the completion marker so a restart cannot repeat the migration.
BEGIN IMMEDIATE;
UPDATE cowork_sessions
SET title = (
  SELECT original_title FROM cowork_scheduled_title_journal WHERE session_id = cowork_sessions.id
)
WHERE EXISTS (
  SELECT 1 FROM cowork_scheduled_title_journal
  WHERE session_id = cowork_sessions.id AND can_restore = 1 AND title = migrated_title
);
UPDATE cowork_scheduled_title_journal SET can_restore = 0;
COMMIT;
