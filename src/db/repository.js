'use strict';

const { initDb } = require('./index');

function createRepository(dbOrOptions) {
  const db = dbOrOptions && typeof dbOrOptions.prepare === 'function'
    ? dbOrOptions
    : initDb(dbOrOptions || {});

  const insertGenerationStmt = db.prepare(`
    INSERT INTO generations (
      timestamp,
      input_file,
      products_count,
      success_count,
      error_count,
      duration_ms,
      output_dir
    ) VALUES (
      @timestamp,
      @input_file,
      @products_count,
      @success_count,
      @error_count,
      @duration_ms,
      @output_dir
    )
  `);

  const insertGenerationItemStmt = db.prepare(`
    INSERT INTO generation_items (
      generation_id,
      position,
      product_name,
      material,
      texture,
      status,
      error_message,
      output_files
    ) VALUES (
      @generation_id,
      @position,
      @product_name,
      @material,
      @texture,
      @status,
      @error_message,
      @output_files
    )
  `);

  const insertAuditStmt = db.prepare('INSERT INTO audit_log (action, user, details, ip) VALUES (@action, @user, @details, @ip)');

  function saveGeneration(payload) {
    const row = {
      timestamp: payload.timestamp || new Date().toISOString(),
      input_file: payload.input_file || null,
      products_count: Number(payload.products_count || 0),
      success_count: Number(payload.success_count || 0),
      error_count: Number(payload.error_count || 0),
      duration_ms: Number(payload.duration_ms || 0),
      output_dir: payload.output_dir || null
    };
    const res = insertGenerationStmt.run(row);
    return Number(res.lastInsertRowid);
  }

  function saveGenerationItem(payload) {
    const row = {
      generation_id: Number(payload.generation_id),
      position: payload.position == null ? null : Number(payload.position),
      product_name: payload.product_name || null,
      material: payload.material || null,
      texture: payload.texture || null,
      status: payload.status || 'error',
      error_message: payload.error_message || null,
      output_files: payload.output_files ? JSON.stringify(payload.output_files) : null
    };
    const res = insertGenerationItemStmt.run(row);
    return Number(res.lastInsertRowid);
  }

  function saveAuditLog(payload) {
    insertAuditStmt.run({
      action: payload.action,
      user: payload.user || 'system',
      details: payload.details ? JSON.stringify(payload.details) : null,
      ip: payload.ip || null
    });
  }

  function getGenerations(options = {}) {
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || options.limit || 20)));
    const offset = (page - 1) * pageSize;

    const total = db.prepare('SELECT COUNT(*) AS count FROM generations').get().count;
    const rows = db.prepare(`
      SELECT id, timestamp, input_file, products_count, success_count, error_count, duration_ms, output_dir
      FROM generations
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    return {
      items: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  function getGenerationById(id) {
    const generation = db.prepare(`
      SELECT id, timestamp, input_file, products_count, success_count, error_count, duration_ms, output_dir
      FROM generations
      WHERE id = ?
    `).get(Number(id));

    if (!generation) return null;

    const items = db.prepare(`
      SELECT generation_id, position, product_name, material, texture, status, error_message, output_files
      FROM generation_items
      WHERE generation_id = ?
      ORDER BY position ASC, id ASC
    `).all(Number(id)).map((item) => ({
      ...item,
      output_files: item.output_files ? JSON.parse(item.output_files) : []
    }));

    return { ...generation, items };
  }

  function getStats(dateRange = {}) {
    const conditions = [];
    const params = [];

    if (dateRange.from) {
      conditions.push('timestamp >= ?');
      params.push(dateRange.from);
    }
    if (dateRange.to) {
      conditions.push('timestamp <= ?');
      params.push(dateRange.to);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_generations,
        COALESCE(SUM(products_count), 0) AS total_products,
        COALESCE(SUM(success_count), 0) AS total_success,
        COALESCE(SUM(error_count), 0) AS total_errors,
        COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
        COALESCE(AVG(duration_ms), 0) AS avg_duration_ms
      FROM generations
      ${whereClause}
    `).get(...params);

    return {
      dateRange: {
        from: dateRange.from || null,
        to: dateRange.to || null
      },
      ...summary
    };
  }

  return {
    db,
    saveGeneration,
    saveGenerationItem,
    saveAuditLog,
    getGenerations,
    getGenerationById,
    getStats
  };
}

module.exports = {
  createRepository
};
