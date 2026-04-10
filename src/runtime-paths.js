const path = require('path');
const fs = require('fs');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getExecutableRoot() {
  return path.dirname(process.execPath);
}

function resolveRuntimeDir(dirName) {
  const execDirCandidate = path.join(getExecutableRoot(), dirName);
  if (process.pkg && fs.existsSync(execDirCandidate)) {
    return execDirCandidate;
  }

  return path.join(getProjectRoot(), dirName);
}

module.exports = {
  resolveRuntimeDir
};
