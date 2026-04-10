const fs = require('fs');
const path = require('path');

const LEVELS = ['error', 'warn', 'info', 'debug'];
let currentLevel = 'info';
let fileStream = null;

function normalizeLevel(level) {
  return LEVELS.includes(level) ? level : 'info';
}

function shouldLog(level) {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(currentLevel);
}

function writeRecord(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta
  };
  const line = JSON.stringify(record);
  process.stdout.write(line + '\n');
  if (fileStream) {
    fileStream.write(line + '\n');
  }
}

function configureLogger({ level = 'info', logFile = null } = {}) {
  currentLevel = normalizeLevel(String(level).toLowerCase());
  if (fileStream) {
    fileStream.end();
    fileStream = null;
  }
  if (logFile) {
    const fullPath = path.resolve(logFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fileStream = fs.createWriteStream(fullPath, { flags: 'a' });
  }
}

function createScopedLogger(defaultMeta = {}) {
  return {
    error(metaOrMsg, maybeMsg) {
      logWithMeta('error', defaultMeta, metaOrMsg, maybeMsg);
    },
    warn(metaOrMsg, maybeMsg) {
      logWithMeta('warn', defaultMeta, metaOrMsg, maybeMsg);
    },
    info(metaOrMsg, maybeMsg) {
      logWithMeta('info', defaultMeta, metaOrMsg, maybeMsg);
    },
    debug(metaOrMsg, maybeMsg) {
      logWithMeta('debug', defaultMeta, metaOrMsg, maybeMsg);
    },
    child(meta) {
      return createScopedLogger({ ...defaultMeta, ...(meta || {}) });
    }
  };
}

function logWithMeta(level, defaultMeta, metaOrMsg, maybeMsg) {
  if (typeof metaOrMsg === 'string') {
    writeRecord(level, metaOrMsg, defaultMeta);
    return;
  }
  const meta = metaOrMsg || {};
  const msg = typeof maybeMsg === 'string' ? maybeMsg : '';
  writeRecord(level, msg, { ...defaultMeta, ...meta });
}

const logger = createScopedLogger();

module.exports = {
  configureLogger,
  logger,
  LEVELS
};
