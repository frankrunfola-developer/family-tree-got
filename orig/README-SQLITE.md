
# SQLite Quick Reference – LineAgeMap (WSL / VS Code)

This guide contains everything you need to manage your `users.db` SQLite database during development.

---

## Open / Exit

### Open the SQLite database
sqlite3 users.db

### Exit SQLite
.quit

### Show help
.help

---

## Make Tables Look Pretty (Readable Output)

### Show results in aligned columns
.mode column

### Show column headers
.headers on

### Example: view users table nicely
SELECT * FROM users;

---

## Extra Pretty Output (Box Mode)

### Display results in a clean boxed table (if supported)
.mode box
.headers on

### Example: view only key columns
SELECT id, email, family_id FROM users;

---

## Control Column Widths

### Set column widths to prevent ugly wrapping (match your selected columns)
.width 6 30 14

### Example with widths applied
SELECT id, email, family_id FROM users;

---

## Export to CSV (View in Excel/Sheets)

### Export query results to a CSV file
.mode csv
.output users.csv
SELECT * FROM users;
.output stdout

---

## Permanent Pretty Mode (Auto-load on startup)

### Create/edit your SQLite config file
# (run this in bash)
# nano ~/.sqliterc

### Put these inside ~/.sqliterc
.mode box
.headers on

---

## Discover Structure

### List all tables
.tables

### Show full schema
.schema

### Show schema for one table
.schema users

### Show actual database file path (verify you're editing correct DB)
PRAGMA database_list;

### Show table columns and types
PRAGMA table_info(users);

### Show indexes
PRAGMA index_list(users);

### Show foreign keys
PRAGMA foreign_key_list(users);

---

## Read Data

### View first 20 rows
SELECT * FROM users LIMIT 20;

### Count rows
SELECT COUNT(*) FROM users;

### Filter rows
SELECT * FROM users WHERE id = 1;

### Search text
SELECT * FROM users WHERE email LIKE '%test%';

### Sort results
SELECT * FROM users ORDER BY id DESC LIMIT 20;

---

## Insert / Update

### Insert a row
INSERT INTO users (email, password_hash) VALUES ('test@example.com', 'hash_here');

### Update a row
UPDATE users SET email='new@example.com' WHERE id=1;

---

## Delete Data

### Delete one row
DELETE FROM users WHERE id=1;

### Delete by condition
DELETE FROM users WHERE email LIKE '%test%';

### Wipe all rows (keep table structure)
DELETE FROM users;

### Wipe all rows + reset AUTOINCREMENT (only if AUTOINCREMENT exists)
DELETE FROM users;
DELETE FROM sqlite_sequence WHERE name='users';

---

## Safe Mode (Transactions)

### Start transaction
BEGIN;

### Commit changes
COMMIT;

### Undo changes
ROLLBACK;

---

## Backup

### Backup entire database
.backup users_backup.db

---

## Maintenance

### Check database integrity
PRAGMA integrity_check;

### Reclaim space after big deletes
VACUUM;

### Show SQLite version
SELECT sqlite_version();

---

## Common Dev Workflow

.tables
.schema users
.mode box
.headers on
SELECT * FROM users LIMIT 20;

BEGIN;
DELETE FROM users WHERE email LIKE '%test%';
SELECT COUNT(*) FROM users;
COMMIT;

---

## Fast Reset (Dev Only)

If you just want to completely reset your dev DB:

rm users.db

Then restart your Flask app (if it recreates schema automatically).
