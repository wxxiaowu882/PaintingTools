#!/usr/bin/env node
/**
 * 正式发版前：北京时间站戳 = MMDD + A/B/C…
 * 例：1029A → 同日再发 1029B；换日 1030A
 *
 *   node docs/site-version-bump.mjs
 *   SKIP_SITE_VERSION_BUMP=1  跳过
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'site-version.json');

function shanghaiParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return map;
}

/** 兼容旧字段 webLabel（曾带 W 前缀） */
function normalizeStamp(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (s.charAt(0) === 'W') s = s.slice(1);
  return s;
}

function nextStamp(prevRaw, mmdd) {
  const prev = normalizeStamp(prevRaw);
  if (prev.indexOf(mmdd) === 0 && prev.length === mmdd.length + 1) {
    const letter = prev.charAt(mmdd.length);
    if (letter >= 'A' && letter < 'Z') {
      return mmdd + String.fromCharCode(letter.charCodeAt(0) + 1);
    }
  }
  return mmdd + 'A';
}

function builtAtIso() {
  const p = shanghaiParts();
  return (
    p.year + '-' + p.month + '-' + p.day +
    'T' + p.hour + ':' + p.minute + ':' + p.second + '+08:00'
  );
}

function main() {
  if (process.env.SKIP_SITE_VERSION_BUMP === '1') {
    console.log('[site-version] SKIP_SITE_VERSION_BUMP=1，跳过');
    return;
  }
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (_e) {}
  const p = shanghaiParts();
  const mmdd = p.month + p.day;
  const webStamp = nextStamp(prev.webStamp || prev.webLabel, mmdd);
  const doc = {
    webStamp,
    scheme: 'V{shellStamp}.{webStamp}',
    timezone: 'Asia/Shanghai',
    builtAt: builtAtIso(),
    note: 'App 显示 V壳戳.站戳；浏览器首页只显示站戳。正式发版自动涨站戳。'
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('[site-version] →', webStamp, '(' + doc.builtAt + ')');
}

main();
