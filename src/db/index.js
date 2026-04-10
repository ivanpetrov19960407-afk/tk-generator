'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'tk-generator.sqlite');

function getMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);
}

function applyMigrations(db, migrationsDir) {
  ensureMigrationsTable(db);
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename));
  const files = getMigrationFiles(migrationsDir);

  const insertApplied = db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file, new Date().toISOString());
    });
    tx();
  }
}

function initDb(options = {}) {
  const dbPath = options.dbPath || process.env.TK_GENERATOR_DB_PATH || DEFAULT_DB_PATH;
  const migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

  if (process.env.NODE_ENV === 'production') {
    db.pragma('journal_mode = WAL');
  }

  db.pragma('foreign_keys = ON');
  applyMigrations(db, migrationsDir);
  return db;
}

module.exports = {
  initDb,
  applyMigrations,
  DEFAULT_DB_PATH
};
