/**
 * Lines of Code (LOC) Counter Script
 * Accurately measures production lines of code (excluding tests, .git, node_modules, data, logs).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXCLUDE_DIRS = ['.git', 'node_modules', 'tests', 'data', 'logs', 'dist', 'coverage'];
const ALLOWED_EXTS = ['.js', '.html', '.css', '.json', '.md'];

let totalLines = 0;
let fileCount = 0;
const byExt = {};

function countDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) {
        countDir(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ALLOWED_EXTS.includes(ext) && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n').length;
        totalLines += lines;
        fileCount++;
        byExt[ext] = (byExt[ext] || 0) + lines;
      }
    }
  }
}

countDir(ROOT);

console.log('--------------------------------------------------');
console.log(`TOTAL PRODUCTION LOC: ${totalLines.toLocaleString()} across ${fileCount} files`);
console.log('Breakdown by extension:', byExt);
console.log('--------------------------------------------------');
