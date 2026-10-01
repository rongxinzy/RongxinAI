# Roll back the scheduled session title migration

The migration records exact original titles in `cowork_scheduled_title_journal`
in the same SQLite transaction as the title updates and completion marker.
The journal belongs to the application database and is not exported or logged.

After reverting the title-normalization code, close the app and open its
`zhiyuan.sqlite` in a SQLite client. Execute the entire
`scripts/rollback-scheduled-session-titles.sql` file. For example, from the
repository root with the SQLite CLI installed:

```powershell
sqlite3 "<user-data-directory>/zhiyuan.sqlite" ".read scripts/rollback-scheduled-session-titles.sql"
```

The script restores only untouched journaled titles. Later renames, changes of
session source, deleted sessions and new sessions are preserved. Renaming away
and back also invalidates the journal entry. Running the rollback twice is safe.
The completion marker remains set, so restarting this code does not reapply the
migration. No sessions or messages are deleted.

A code revert alone does not restore database values. If the earlier PR version
already completed the migration without a journal, exact original titles cannot
be reconstructed; restoration then requires a database backup from before that
migration. The rollback script requires a database with the journal table.

SQLite connections, transactions and writes remain owned by the main process.
This migration uses SQL directly without scanning files, parsing content or
materializing all session rows in JavaScript.
