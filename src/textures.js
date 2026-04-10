'use strict';

const SUPPORTED_TEXTURES = Object.freeze([
  'лощение',
  'рельефная_матовая',
  'бучардирование_лощение'
]);

function formatSupportedTextures() {
  return SUPPORTED_TEXTURES.join(', ');
}

module.exports = {
  SUPPORTED_TEXTURES,
  formatSupportedTextures
};
