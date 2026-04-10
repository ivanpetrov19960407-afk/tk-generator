ALTER TABLE generation_items ADD COLUMN total_cost REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_generations_timestamp ON generations(timestamp);
CREATE INDEX IF NOT EXISTS idx_generation_items_material ON generation_items(material);
CREATE INDEX IF NOT EXISTS idx_generation_items_texture ON generation_items(texture);
