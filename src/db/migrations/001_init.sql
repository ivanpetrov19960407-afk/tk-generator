CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  input_file TEXT,
  products_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  output_dir TEXT
);

CREATE TABLE IF NOT EXISTS generation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id INTEGER NOT NULL,
  position INTEGER,
  product_name TEXT,
  material TEXT,
  texture TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  output_files TEXT,
  FOREIGN KEY(generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generation_items_generation_id ON generation_items(generation_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  user TEXT,
  details TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
