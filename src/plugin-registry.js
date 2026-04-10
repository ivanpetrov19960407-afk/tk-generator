'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRuntimeDir } = require('./runtime-paths');

const BUILTIN_MATERIAL_DENSITIES = Object.freeze({
  'мрамор': 2700,
  'гранит': 2700,
  'известняк': 2400,
  'травертин': 2500,
  'песчаник': 2300,
  'сланец': 2700,
  'оникс': 2700
});

const builtinOperations = JSON.parse(
  fs.readFileSync(path.join(resolveRuntimeDir('data'), 'operations_library.json'), 'utf8')
);

const state = {
  materials: new Map(),
  textures: new Map(),
  exporters: new Map(),
  pluginOperations: [],
  plugins: []
};

for (const [materialType, density] of Object.entries(BUILTIN_MATERIAL_DENSITIES)) {
  state.materials.set(materialType, { type: materialType, density, source: 'builtin' });
}

for (const textureKey of Object.keys(builtinOperations)) {
  state.textures.set(textureKey, { key: textureKey, source: 'builtin' });
}

function cloneOperationsTemplate(template) {
  return JSON.parse(JSON.stringify(template));
}

function getOperationsTemplate(textureKey) {
  if (Object.prototype.hasOwnProperty.call(builtinOperations, textureKey)) {
    return cloneOperationsTemplate(builtinOperations[textureKey]);
  }

  const texture = state.textures.get(textureKey);
  if (texture && texture.operationsTemplate) {
    return cloneOperationsTemplate(texture.operationsTemplate);
  }

  return null;
}

function registerMaterial(config = {}, pluginMeta = {}) {
  if (!config.type || typeof config.type !== 'string') {
    throw new Error('registerMaterial: поле type обязательно');
  }
  const normalizedType = config.type.toLowerCase();
  const density = config.density != null ? Number(config.density) : null;
  state.materials.set(normalizedType, {
    type: normalizedType,
    name: config.name || normalizedType,
    density: Number.isFinite(density) && density > 0 ? density : null,
    source: pluginMeta.name || 'runtime'
  });
}

function registerTexture(config = {}, pluginMeta = {}) {
  if (!config.key || typeof config.key !== 'string') {
    throw new Error('registerTexture: поле key обязательно');
  }
  const payload = {
    key: config.key,
    displayName: config.displayName || config.key,
    operationsTemplate: config.operationsTemplate || null,
    source: pluginMeta.name || 'runtime'
  };
  state.textures.set(config.key, payload);
}

function registerOperation(config = {}, pluginMeta = {}) {
  if (!config.texture || typeof config.texture !== 'string') {
    throw new Error('registerOperation: поле texture обязательно');
  }
  if (!Number.isInteger(config.number) || config.number <= 0) {
    throw new Error('registerOperation: поле number должно быть целым числом > 0');
  }
  if ((!config.title || typeof config.title !== 'string') && (!config.text || typeof config.text !== 'string')) {
    throw new Error('registerOperation: нужно указать title и/или text');
  }

  state.pluginOperations.push({
    texture: config.texture,
    number: config.number,
    title: config.title,
    text: config.text,
    source: pluginMeta.name || 'runtime'
  });
}

function registerExporter(config = {}, pluginMeta = {}) {
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('registerExporter: поле name обязательно');
  }
  if (typeof config.handler !== 'function') {
    throw new Error('registerExporter: поле handler должно быть функцией');
  }
  state.exporters.set(config.name, {
    name: config.name,
    handler: config.handler,
    source: pluginMeta.name || 'runtime'
  });
}

function applyOperationPlugins(templateOps, textureKey) {
  const result = cloneOperationsTemplate(templateOps);
  for (const patch of state.pluginOperations) {
    if (patch.texture !== textureKey) continue;
    const opKey = String(patch.number);
    if (!result[opKey]) continue;
    if (patch.title) result[opKey].title = patch.title;
    if (patch.text) result[opKey].text = patch.text;
  }
  return result;
}

function getSupportedTextures() {
  return [...state.textures.keys()];
}

function formatSupportedTextures() {
  return getSupportedTextures().join(', ');
}

function getDefaultDensityByMaterialType(type) {
  if (!type) return null;
  const key = String(type).toLowerCase();
  const material = state.materials.get(key);
  return material ? material.density : null;
}

function addLoadedPlugin(metadata) {
  state.plugins.push(metadata);
}

function getLoadedPlugins() {
  return [...state.plugins];
}

module.exports = {
  registerMaterial,
  registerTexture,
  registerOperation,
  registerExporter,
  getOperationsTemplate,
  applyOperationPlugins,
  getSupportedTextures,
  formatSupportedTextures,
  getDefaultDensityByMaterialType,
  addLoadedPlugin,
  getLoadedPlugins,
  cloneOperationsTemplate
};
