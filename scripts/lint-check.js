/**
 * Zero-dependency Static Code & Syntax Linter
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let checkedFiles = 0;
let syntaxErrors = 0;

function lintDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!['.git', 'node_modules', 'data', 'logs', 'dist', 'coverage'].includes(entry.name)) {
        lintDir(path.join(dir, entry.name));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      checkedFiles++;
      const code = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      try {
        new vm.Script(code);
      } catch (err) {
        console.error(`Syntax Error in ${entry.name}: ${err.message}`);
        syntaxErrors++;
      }
    }
  }
}

lintDir(ROOT);
console.log(`[Linter] Linted ${checkedFiles} JavaScript source files. Syntax errors: ${syntaxErrors}`);
process.exit(syntaxErrors === 0 ? 0 : 1);
