const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), "Library", "Application Support", "learnerapp", "learner.sqlite");

if (!fs.existsSync(databasePath)) {
  throw new Error(`Database not found: ${databasePath}`);
}

const backupDirectory = path.join(path.dirname(databasePath), "backups");
fs.mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDirectory, `learner-before-revision-${timestamp}.sqlite`);
const quotedBackupPath = `'${backupPath.replaceAll("'", "''")}'`;

const source = new DatabaseSync(databasePath);
source.exec("PRAGMA busy_timeout = 10000");
source.exec("PRAGMA wal_checkpoint(PASSIVE)");
source.exec(`VACUUM INTO ${quotedBackupPath}`);
source.close();

const backup = new DatabaseSync(backupPath, { readOnly: true });
const check = backup.prepare("PRAGMA quick_check").all();
backup.close();

if (check.length !== 1 || check[0].quick_check !== "ok") {
  fs.rmSync(backupPath, { force: true });
  throw new Error(`Backup verification failed: ${JSON.stringify(check)}`);
}

console.log(backupPath);
console.log("quick_check: ok");
