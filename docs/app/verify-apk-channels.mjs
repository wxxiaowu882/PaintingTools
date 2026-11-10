#!/usr/bin/env node
/**
 * 发版前校验：正式 / 测站 APK 包名不得搞反，避免测站下载覆盖正式 App。
 *
 * 口径：
 * - docs/app/wuxiao-workshop.apk          → com.wuxiaoart.workshop（桌面「手绘工坊」）
 * - docs/app/wuxiao-workshop-staging.apk  → com.wuxiaoart.workshop.staging（桌面「手绘工坊·测」）
 * - /api/android-apk 已按域名分流；本脚本拦「文件拷错」这一类事故
 *
 * 用法：node docs/app/verify-apk-channels.mjs
 * 环境：可选 SKIP_APK_CHANNEL_CHECK=1 跳过（须向用户说明风险）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const prodApk = path.join(repoRoot, 'docs/app/wuxiao-workshop.apk');
const stagingApk = path.join(repoRoot, 'docs/app/wuxiao-workshop-staging.apk');

const PROD_PKG = 'com.wuxiaoart.workshop';
const STAGING_PKG = 'com.wuxiaoart.workshop.staging';

if (process.env.SKIP_APK_CHANNEL_CHECK === '1') {
  console.warn('[verify-apk-channels] SKIP_APK_CHANNEL_CHECK=1 — skipped');
  process.exit(0);
}

function findAapt() {
  const envSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const candidates = [];
  if (envSdk) candidates.push(envSdk);
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, 'Android', 'Sdk'));
  candidates.push(path.join(process.env.HOME || '', 'AppData', 'Local', 'Android', 'Sdk'));
  for (const sdk of candidates) {
    if (!sdk || !fs.existsSync(sdk)) continue;
    const bt = path.join(sdk, 'build-tools');
    if (!fs.existsSync(bt)) continue;
    const versions = fs
      .readdirSync(bt)
      .filter((d) => fs.existsSync(path.join(bt, d, process.platform === 'win32' ? 'aapt.exe' : 'aapt')))
      .sort();
    if (!versions.length) continue;
    const latest = versions[versions.length - 1];
    return path.join(bt, latest, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  }
  return null;
}

/**
 * aapt 在含中文的仓库路径上常报 Illegal byte sequence。
 * 先拷到纯 ASCII 临时目录再 dump（Windows 天坑）。
 */
function dumpPackage(aapt, apkPath) {
  const tmpRoot = process.platform === 'win32' ? 'C:\\tmp\\apkchk-verify' : '/tmp/apkchk-verify';
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmpApk = path.join(tmpRoot, `chk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.apk`);
  try {
    fs.copyFileSync(apkPath, tmpApk);
    const r = spawnSync(aapt, ['dump', 'badging', tmpApk], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    if (r.status !== 0) {
      throw new Error(`aapt dump failed for ${apkPath}: ${r.stderr || r.stdout || r.error}`);
    }
    const out = String(r.stdout || '');
    const pkg = (out.match(/package: name='([^']+)'/) || [])[1] || '';
    const label = (out.match(/application-label:'([^']*)'/) || [])[1] || '';
    const versionName = (out.match(/versionName='([^']*)'/) || [])[1] || '';
    const versionCode = (out.match(/versionCode='([^']*)'/) || [])[1] || '';
    return { pkg, label, versionName, versionCode, rawHead: out.split('\n').slice(0, 4).join('\n') };
  } finally {
    try {
      fs.unlinkSync(tmpApk);
    } catch {
      /* ignore */
    }
  }
}

function fail(msg) {
  console.error('[verify-apk-channels] FAIL:', msg);
  process.exit(1);
}

function main() {
  const aapt = findAapt();
  if (!aapt) {
    fail(
      '找不到 aapt（Android SDK build-tools）。无法校验 APK 包名。请安装 SDK，或临时 SKIP_APK_CHANNEL_CHECK=1（有覆盖正式 App 风险）。'
    );
  }

  const checks = [
    {
      file: prodApk,
      expectPkg: PROD_PKG,
      forbidSuffix: '.staging',
      labelHint: '手绘工坊',
      forbidLabel: '测',
      role: '正式壳 wuxiao-workshop.apk',
    },
    {
      file: stagingApk,
      expectPkg: STAGING_PKG,
      requireSuffix: '.staging',
      labelHint: '测',
      role: '测站壳 wuxiao-workshop-staging.apk',
    },
  ];

  for (const c of checks) {
    if (!fs.existsSync(c.file)) {
      console.warn(`[verify-apk-channels] WARN: missing ${path.relative(repoRoot, c.file)} — skip that file`);
      continue;
    }
    const info = dumpPackage(aapt, c.file);
    console.log(`[verify-apk-channels] ${c.role}: pkg=${info.pkg} label=${info.label} v=${info.versionName}(${info.versionCode})`);
    if (info.pkg !== c.expectPkg) {
      fail(
        `${c.role} 包名错误：期望 ${c.expectPkg}，实际 ${info.pkg}。` +
          `测站下载若发错正式包，会覆盖用户桌面「手绘工坊」。请重新拷贝对应 flavor 的 APK。`
      );
    }
    if (c.forbidSuffix && info.pkg.endsWith(c.forbidSuffix)) {
      fail(`${c.role} 不应带 ${c.forbidSuffix}`);
    }
    if (c.requireSuffix && !info.pkg.endsWith(c.requireSuffix)) {
      fail(`${c.role} 必须是 ${c.expectPkg}`);
    }
    if (c.forbidLabel && String(info.label).includes(c.forbidLabel)) {
      fail(`${c.role} 桌面名含「${c.forbidLabel}」，疑似测站包误放到正式路径`);
    }
    if (c.labelHint === '测' && !String(info.label).includes('测')) {
      fail(`${c.role} 桌面名应为「手绘工坊·测」一类，实际「${info.label}」`);
    }
  }

  // 若两文件都在，禁止内容完全同包名（已在上面逐个校验，这里再防拷贝同一文件）
  if (fs.existsSync(prodApk) && fs.existsSync(stagingApk)) {
    const a = dumpPackage(aapt, prodApk);
    const b = dumpPackage(aapt, stagingApk);
    if (a.pkg === b.pkg) {
      fail(`正式与测站 APK 包名相同（${a.pkg}），同机无法并存，且测站会覆盖正式。`);
    }
  }

  console.log('[verify-apk-channels] OK — 正式/测站 APK 渠道未搞反');
}

main();
