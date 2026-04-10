'use strict';

const path = require('path');

const SAFE_NAME_PATTERN = /[^a-zA-Z0-9-_]/g;

function sanitizeName(input, fallback = 'item') {
  const raw = String(input == null ? '' : input);
  const sanitized = raw.replace(SAFE_NAME_PATTERN, '_').replace(/^_+|_+$/g, '');
  return sanitized || fallback;
}

function ensureSafePath(baseDir, unsafeName) {
  const resolvedBase = path.resolve(baseDir);
  const safeName = sanitizeName(unsafeName);
  const finalPath = path.resolve(path.join(resolvedBase, safeName));
  if (!finalPath.startsWith(`${resolvedBase}${path.sep}`) && finalPath !== resolvedBase) {
    const err = new Error('Path traversal detected');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }
  return { safeName, finalPath, resolvedBase };
}

function resolvePathInAllowedDir(allowedDir, targetPath) {
  const resolvedAllowedDir = path.resolve(allowedDir);
  const resolvedPath = path.resolve(targetPath);
  if (!resolvedPath.startsWith(`${resolvedAllowedDir}${path.sep}`) && resolvedPath !== resolvedAllowedDir) {
    const err = new Error('Forbidden overrides path');
    err.code = 'FORBIDDEN_PATH';
    throw err;
  }
  return resolvedPath;
}

function isDangerousCsvValue(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value);
}

function sanitizeCsvValue(value) {
  return isDangerousCsvValue(value) ? `'${value}` : value;
}

module.exports = {
  sanitizeName,
  ensureSafePath,
  resolvePathInAllowedDir,
  sanitizeCsvValue
};
