'use strict';

const fs = require('fs');
const path = require('path');
const {
  registerMaterial,
  registerOperation,
  registerTexture,
  registerExporter,
  addLoadedPlugin,
  getLoadedPlugins
} = require('./plugin-registry');

const ALLOWED_TYPES = new Set(['material', 'operation', 'texture', 'export']);

function validateManifest(manifest, pluginDirName) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`manifest.json в плагине "${pluginDirName}" должен быть объектом`);
  }

  for (const key of ['name', 'version', 'type', 'dependencies']) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
      throw new Error(`manifest.json плагина "${pluginDirName}": отсутствует поле "${key}"`);
    }
  }

  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error(`manifest.json плагина "${pluginDirName}": поле name должно быть непустой строкой`);
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`manifest.json плагина "${pluginDirName}": поле version должно быть непустой строкой`);
  }
  if (!ALLOWED_TYPES.has(manifest.type)) {
    throw new Error(`manifest.json плагина "${pluginDirName}": недопустимый type="${manifest.type}"`);
  }
  if (!Array.isArray(manifest.dependencies)) {
    throw new Error(`manifest.json плагина "${pluginDirName}": поле dependencies должно быть массивом`);
  }
}

function resolveLoadOrder(plugins) {
  const byName = new Map(plugins.map((p) => [p.manifest.name, p]));
  const indegree = new Map();
  const edges = new Map();

  for (const p of plugins) {
    indegree.set(p.manifest.name, 0);
    edges.set(p.manifest.name, []);
  }

  for (const p of plugins) {
    for (const dep of p.manifest.dependencies) {
      if (!byName.has(dep)) {
        throw new Error(`Плагин "${p.manifest.name}" требует зависимость "${dep}", но она не найдена`);
      }
      edges.get(dep).push(p.manifest.name);
      indegree.set(p.manifest.name, indegree.get(p.manifest.name) + 1);
    }
  }

  const queue = [...plugins.filter((p) => indegree.get(p.manifest.name) === 0).map((p) => p.manifest.name)];
  const ordered = [];

  while (queue.length > 0) {
    const name = queue.shift();
    ordered.push(byName.get(name));
    for (const next of edges.get(name)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  if (ordered.length !== plugins.length) {
    throw new Error('Обнаружен циклический граф зависимостей плагинов');
  }

  return ordered;
}

function loadPlugins(options = {}) {
  const pluginsDir = options.pluginsDir || path.resolve(process.cwd(), 'plugins');
  const disabled = new Set((options.disabledPlugins || []).map((x) => String(x).trim()).filter(Boolean));
  const allowedPlugins = new Set((options.allowedPlugins || []).map((x) => String(x).trim()).filter(Boolean));
  const pluginsEnabled = options.pluginsEnabled !== false;
  const report = [];

  if (!pluginsEnabled) {
    return { pluginsDir, loaded: [], skipped: [{ name: '*', status: 'disabled', reason: 'plugins_enabled=false' }], errors: [], report: [{ name: '*', status: 'disabled', reason: 'plugins_enabled=false' }] };
  }

  if (!fs.existsSync(pluginsDir)) {
    return { pluginsDir, loaded: [], skipped: [], errors: [], report };
  }

  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const candidates = [];

  for (const dirEntry of dirs) {
    const pluginPath = path.join(pluginsDir, dirEntry.name);
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const indexPath = path.join(pluginPath, 'index.js');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
      report.push({ name: dirEntry.name, status: 'skipped', reason: 'Отсутствует manifest.json или index.js' });
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest, dirEntry.name);

    if (disabled.has(manifest.name)) {
      report.push({ name: manifest.name, status: 'disabled', reason: 'Отключен через CLI' });
      continue;
    }

    if (allowedPlugins.size > 0 && !allowedPlugins.has(manifest.name)) {
      report.push({ name: manifest.name, status: 'error', reason: 'Plugin not allowed' });
      continue;
    }

    candidates.push({ manifest, pluginPath, indexPath, dirName: dirEntry.name });
  }

  const ordered = resolveLoadOrder(candidates);
  const loaded = [];
  const errors = report.filter((x) => x.status === 'error').map((x) => ({ name: x.name, error: x.reason }));

  for (const item of ordered) {
    try {
      const register = require(item.indexPath);
      if (typeof register !== 'function') {
        throw new Error('index.js должен экспортировать функцию');
      }

      register({
        manifest: item.manifest,
        registerMaterial: (config) => registerMaterial(config, item.manifest),
        registerOperation: (config) => registerOperation(config, item.manifest),
        registerTexture: (config) => registerTexture(config, item.manifest),
        registerExporter: (config) => registerExporter(config, item.manifest)
      });

      const pluginMeta = {
        name: item.manifest.name,
        version: item.manifest.version,
        type: item.manifest.type,
        dependencies: item.manifest.dependencies,
        path: item.pluginPath
      };
      loaded.push(pluginMeta);
      addLoadedPlugin(pluginMeta);
      report.push({ name: item.manifest.name, status: 'loaded' });
    } catch (error) {
      errors.push({ name: item.manifest.name, error: error.message });
      report.push({ name: item.manifest.name, status: 'error', reason: error.message });
    }
  }

  return {
    pluginsDir,
    loaded,
    skipped: report.filter((x) => x.status === 'disabled' || x.status === 'skipped'),
    errors,
    report,
    allLoadedPlugins: getLoadedPlugins()
  };
}

module.exports = {
  loadPlugins,
  validateManifest,
  resolveLoadOrder
};
