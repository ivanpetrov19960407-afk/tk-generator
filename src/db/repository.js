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
      total_cost,
      status,
      error_message,
      output_files
    ) VALUES (
      @generation_id,
      @position,
      @product_name,
      @material,
      @texture,
      @total_cost,
      @status,
      @error_message,
      @output_files
    )
  `);

  const insertAuditStmt = db.prepare('INSERT INTO audit_log (action, user, details, ip) VALUES (@action, @user, @details, @ip)');
  const insertUserStmt = db.prepare(`
    INSERT INTO users (
      username,
      password_hash,
      role,
      is_active,
      created_at
    ) VALUES (
      @username,
      @password_hash,
      @role,
      @is_active,
      @created_at
    )
  `);
  const updateUserLastLoginStmt = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?');
  const listWebhooksStmt = db.prepare('SELECT id, url, events, secret, enabled, created_at, updated_at FROM webhooks ORDER BY id ASC');
  const getWebhookByIdStmt = db.prepare('SELECT id, url, events, secret, enabled, created_at, updated_at FROM webhooks WHERE id = ?');
  const insertWebhookStmt = db.prepare(`
    INSERT INTO webhooks (
      url,
      events,
      secret,
      enabled,
      created_at,
      updated_at
    ) VALUES (
      @url,
      @events,
      @secret,
      @enabled,
      @created_at,
      @updated_at
    )
  `);
  const deleteWebhookStmt = db.prepare('DELETE FROM webhooks WHERE id = ?');

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
      total_cost: Number(payload.total_cost || 0),
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
      SELECT generation_id, position, product_name, material, texture, total_cost, status, error_message, output_files
      FROM generation_items
      WHERE generation_id = ?
      ORDER BY position ASC, id ASC
    `).all(Number(id)).map((item) => ({
      ...item,
      total_cost: Number(item.total_cost || 0),
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

  function buildAnalyticsFilter(filter = {}) {
    const conditions = ['gi.status = ?'];
    const params = ['success'];

    if (filter.from) {
      conditions.push('g.timestamp >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('g.timestamp <= ?');
      params.push(filter.to);
    }
    if (filter.material) {
      conditions.push('LOWER(COALESCE(gi.material, "")) = LOWER(?)');
      params.push(filter.material);
    }
    if (filter.texture) {
      conditions.push('LOWER(COALESCE(gi.texture, "")) = LOWER(?)');
      params.push(filter.texture);
    }

    return {
      whereClause: `WHERE ${conditions.join(' AND ')}`,
      params
    };
  }

  function getAnalyticsSummary(filter = {}) {
    const { whereClause, params } = buildAnalyticsFilter(filter);
    return db.prepare(`
      SELECT
        COUNT(DISTINCT gi.generation_id) AS total_generations,
        COUNT(*) AS total_products,
        COALESCE(AVG(gi.total_cost), 0) AS average_cost,
        COALESCE(SUM(gi.total_cost), 0) AS total_cost
      FROM generation_items gi
      INNER JOIN generations g ON g.id = gi.generation_id
      ${whereClause}
    `).get(...params);
  }

  function getAnalyticsCostTrends(filter = {}) {
    const groupBy = String(filter.groupBy || 'day').toLowerCase() === 'week' ? 'week' : 'day';
    const bucketExpr = groupBy === 'week'
      ? "strftime('%Y-W%W', g.timestamp)"
      : "strftime('%Y-%m-%d', g.timestamp)";
    const { whereClause, params } = buildAnalyticsFilter(filter);
    return db.prepare(`
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS products,
        COALESCE(AVG(gi.total_cost), 0) AS average_cost,
        COALESCE(SUM(gi.total_cost), 0) AS total_cost
      FROM generation_items gi
      INNER JOIN generations g ON g.id = gi.generation_id
      ${whereClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(...params).map((row) => ({
      ...row,
      average_cost: Number(row.average_cost || 0),
      total_cost: Number(row.total_cost || 0)
    }));
  }

  function getAnalyticsMaterials(filter = {}) {
    const { whereClause, params } = buildAnalyticsFilter(filter);
    const limit = Math.min(25, Math.max(1, Number(filter.limit || 10)));
    return db.prepare(`
      SELECT
        COALESCE(NULLIF(gi.material, ''), 'Не указан') AS material,
        COUNT(*) AS products,
        COALESCE(SUM(gi.total_cost), 0) AS total_cost,
        COALESCE(AVG(gi.total_cost), 0) AS average_cost
      FROM generation_items gi
      INNER JOIN generations g ON g.id = gi.generation_id
      ${whereClause}
      GROUP BY material
      ORDER BY total_cost DESC, products DESC
      LIMIT ?
    `).all(...params, limit).map((row) => ({
      ...row,
      total_cost: Number(row.total_cost || 0),
      average_cost: Number(row.average_cost || 0)
    }));
  }

  function getAnalyticsTextures(filter = {}) {
    const { whereClause, params } = buildAnalyticsFilter(filter);
    return db.prepare(`
      SELECT
        COALESCE(NULLIF(gi.texture, ''), 'Не указана') AS texture,
        COUNT(*) AS products
      FROM generation_items gi
      INNER JOIN generations g ON g.id = gi.generation_id
      ${whereClause}
      GROUP BY texture
      ORDER BY products DESC, texture ASC
    `).all(...params);
  }

  function countUsers() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count || 0);
  }

  function getUserByUsername(username) {
    if (!username) return null;
    return db.prepare('SELECT id, username, password_hash, role, is_active, created_at, last_login_at FROM users WHERE username = ?').get(String(username).trim());
  }

  function getUserById(id) {
    return db.prepare('SELECT id, username, password_hash, role, is_active, created_at, last_login_at FROM users WHERE id = ?').get(Number(id));
  }

  function touchUserLogin(userId) {
    updateUserLastLoginStmt.run(new Date().toISOString(), Number(userId));
  }

  function createUser(payload) {
    const row = {
      username: String(payload.username || '').trim(),
      password_hash: payload.passwordHash,
      role: payload.role || 'viewer',
      is_active: payload.is_active == null ? 1 : Number(payload.is_active ? 1 : 0),
      created_at: payload.created_at || new Date().toISOString()
    };
    const res = insertUserStmt.run(row);
    return getUserById(Number(res.lastInsertRowid));
  }

  function normalizeWebhook(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      url: row.url,
      events: row.events ? JSON.parse(row.events) : [],
      secret: row.secret || null,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function listWebhooks() {
    return listWebhooksStmt.all().map(normalizeWebhook);
  }

  function createWebhook(payload) {
    const nowIso = new Date().toISOString();
    const row = {
      url: String(payload.url || '').trim(),
      events: JSON.stringify(Array.isArray(payload.events) ? payload.events : []),
      secret: payload.secret ? String(payload.secret) : null,
      enabled: payload.enabled == null ? 1 : Number(payload.enabled ? 1 : 0),
      created_at: nowIso,
      updated_at: nowIso
    };
    const res = insertWebhookStmt.run(row);
    return normalizeWebhook(getWebhookByIdStmt.get(Number(res.lastInsertRowid)));
  }

  function deleteWebhook(id) {
    const row = normalizeWebhook(getWebhookByIdStmt.get(Number(id)));
    if (!row) return null;
    deleteWebhookStmt.run(Number(id));
    return row;
  }

  return {
    db,
    saveGeneration,
    saveGenerationItem,
    saveAuditLog,
    getGenerations,
    getGenerationById,
    getStats,
    getAnalyticsSummary,
    getAnalyticsCostTrends,
    getAnalyticsMaterials,
    getAnalyticsTextures,
    countUsers,
    getUserByUsername,
    getUserById,
    createUser,
    touchUserLogin,
    listWebhooks,
    createWebhook,
    deleteWebhook
  };
}

module.exports = {
  createRepository
};
