# SQL File Execution Design

## Goal

Add a first-class workflow for executing `.sql` files against a selected connection and database. The feature targets common migration, initialization, and dump-restore tasks where users need to run a script file, see progress, stop on errors by default, and cancel long-running execution.

## Entry Points

- Add a toolbar action labeled "Execute SQL File".
- Add a context-menu action labeled "Execute SQL File" on connection and database tree nodes.
- The context-menu entry opens the same dialog as the toolbar action, with the current connection and database preselected when available.

## Dialog Behavior

The dialog lets the user choose:

- Connection.
- Database, when the selected connection supports databases.
- SQL file path.
- Failure policy.

The default failure policy is to stop on the first failed statement. A secondary option allows continuing after statement failures.

Before execution, the dialog shows the file name, size, and a small preview from the beginning of the file. The preview is informational only; execution uses the file path directly so large files do not need to be loaded into frontend memory.

During execution, the dialog shows:

- Current statement index.
- Successful statement count.
- Failed statement count.
- Elapsed time.
- Current statement summary.
- Last error, if any.

The dialog provides a Cancel button while execution is active.

## Backend Architecture

Add a new SQL file execution command family:

- `execute_sql_file(connection_id, database, file_path, execution_id, continue_on_error)`.
- `cancel_sql_file_execution(execution_id)`.

The backend reads the file incrementally from disk and splits it into statements as it reads. It executes statements one at a time using the existing query execution path so database-specific connection handling, reconnect behavior, timeout behavior, and result handling remain consistent with the query editor.

Execution sends progress events through Tauri:

- `started`: file execution has begun.
- `statementDone`: one statement completed successfully.
- `statementFailed`: one statement failed.
- `cancelled`: execution stopped because the user cancelled.
- `done`: execution completed.

Each event includes the `execution_id` so the frontend can ignore events from stale runs.

## SQL Splitting

The first implementation supports standard semicolon-delimited SQL files. The splitter must ignore semicolons inside:

- Single-quoted strings.
- Double-quoted strings.
- Backtick-quoted identifiers.
- Line comments.
- Block comments.

The splitter also emits a final trailing statement when the file does not end with a semicolon.

MySQL `DELIMITER` syntax for stored procedures is intentionally out of scope for this first PR. If a file depends on custom delimiters, execution may fail at the relevant statement and report the failing index. A later PR can add delimiter directives without blocking the common migration and initialization cases.

## Failure And Cancellation

Default behavior is stop-on-first-error. When a statement fails:

- Emit `statementFailed`.
- Stop immediately unless `continue_on_error` is true.
- Report the failing statement index and the count of statements that may already have committed.

When `continue_on_error` is true, execution continues after failures and emits a final summary including successful and failed counts.

Cancellation uses a cancellation token keyed by `execution_id`. Cancelling stops before the next statement when possible and also passes the token into the active statement execution path so supported drivers can stop promptly. The UI should show cancellation as a stopped state rather than a generic SQL error.

## Frontend Architecture

Add a dedicated SQL file execution dialog component. The component owns:

- File selection via Tauri dialog.
- Connection and database selection.
- Preview metadata.
- Execution progress state.
- Cancel action.

Add lightweight API wrappers in `src/lib/tauri.ts` for the two backend commands and the progress event payload type.

Do not store SQL file execution as a normal query tab. A file execution can contain many statements and progress events, so a modal task workflow is clearer than overloading the query result grid.

## Testing

Rust tests:

- Split multiple statements by semicolon.
- Ignore semicolons in single-quoted strings.
- Ignore semicolons in double-quoted strings.
- Ignore semicolons in backtick identifiers.
- Ignore semicolons in line comments and block comments.
- Emit trailing statement without a final semicolon.
- Stop on first failure when `continue_on_error` is false.
- Continue after failure when `continue_on_error` is true.
- Stop execution after cancellation.

Frontend verification:

- Typecheck and production build.
- Manual smoke test with a small SQL file showing successful progress.
- Manual smoke test with a failing second statement showing stop-on-error and the failing index.

## Scope Boundaries

In scope:

- Local `.sql` file selection.
- Streaming backend execution.
- Progress events.
- Stop-on-error default.
- Continue-on-error option.
- Cancellation.
- Toolbar and tree context-menu entry points.

Out of scope for this PR:

- MySQL custom `DELIMITER` directives.
- Transaction wrapping of the whole file.
- Remote file URLs.
- Saving import history.
- Editing the SQL file inside dbx before execution.
