const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runsDir = path.join(root, 'runs');

function removeChildren(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  for (const name of fs.readdirSync(targetDir)) {
    const fullPath = path.join(targetDir, name);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

removeChildren(runsDir);
console.log(`Cleaned ${runsDir}`);
