'use strict';

module.exports = async function pdfParse(buffer) {
  const content = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
  const numpages = (content.match(/\/Type\s*\/Page\b/g) || []).length;
  return { numpages, text: '' };
};
