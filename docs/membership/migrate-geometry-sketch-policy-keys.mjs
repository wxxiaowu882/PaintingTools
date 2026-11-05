/**
 * 把写生场景权限键从 scene:geometry:… 迁到 scene:geometrysketch:…
 * （4B：新 sandbox 键；uid/课名不变）
 *
 * node docs/membership/migrate-geometry-sketch-policy-keys.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(__dirname, 'access-policy.json');
const PREFIX_OLD = 'scene:geometry:name:';
const PREFIX_NEW = 'scene:geometrysketch:name:';
const dry = process.argv.includes('--dry-run');

function isSketchSceneKey(key) {
  if (!key.startsWith(PREFIX_OLD)) return false;
  const name = key.slice(PREFIX_OLD.length);
  return name.includes('几何体写生') || name.includes('静物写生');
}

const raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const resources = raw.resources || {};
const next = { ...resources };
let moved = 0;
for (const key of Object.keys(resources)) {
  if (!isSketchSceneKey(key)) continue;
  const name = key.slice(PREFIX_OLD.length);
  const nk = PREFIX_NEW + name;
  next[nk] = { ...resources[key] };
  delete next[key];
  moved++;
  console.log(key, '->', nk);
}
raw.resources = next;
console.log('moved', moved);
if (!dry) {
  fs.writeFileSync(policyPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  console.log('wrote', policyPath);
} else {
  console.log('dry-run: no write');
}
