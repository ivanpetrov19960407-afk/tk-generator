'use strict';

const fs = require('fs');
const path = require('path');

function getCallerFile() {
  const err = new Error();
  const stack = String(err.stack || '').split('\n').slice(2);
  for (const line of stack) {
    const match = line.match(/\((.*?):\d+:\d+\)$/) || line.match(/at (.*?):\d+:\d+$/);
    if (match && !match[1].includes(path.join('vendor', 'bindings'))) {
      return match[1];
    }
  }
  return module.parent && module.parent.filename ? module.parent.filename : process.cwd();
}

module.exports = function bindings(nameOrOptions) {
  const bindingName = typeof nameOrOptions === 'string'
    ? nameOrOptions
    : (nameOrOptions && (nameOrOptions.bindings || nameOrOptions.path)) || 'binding.node';

  const callerFile = getCallerFile();
  const callerDir = path.dirname(callerFile);
  const packageRoot = path.resolve(callerDir, '..');

  const candidates = [
    path.join(packageRoot, 'build', 'Release', bindingName),
    path.join(packageRoot, 'build', 'Debug', bindingName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }

  const err = new Error(`Could not locate the bindings file. Tried:\n${candidates.join('\n')}`);
  err.tries = candidates;
  throw err;
};
