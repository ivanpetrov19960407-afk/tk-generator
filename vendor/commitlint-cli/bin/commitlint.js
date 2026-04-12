#!/usr/bin/env node
const fs = require('fs');

const args = process.argv.slice(2);
let msgPath = '';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--edit' && args[i + 1]) {
    msgPath = args[i + 1];
  }
}

if (!msgPath) {
  process.exit(0);
}

const message = fs.readFileSync(msgPath, 'utf8').split('\n')[0].trim();
const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-/.]+\))?!?: .+/;
if (!conventional.test(message)) {
  console.error('⛔ commit message must follow Conventional Commits: type(scope): subject');
  process.exit(1);
}
