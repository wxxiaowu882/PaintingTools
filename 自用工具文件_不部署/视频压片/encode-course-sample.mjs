#!/usr/bin/env node
/**
 * C1 本地压片（正课档草案）
 * - 横屏教学默认：1080p、H.264、约 3.5Mbps、AAC 128k、yuv420p、faststart
 * - 竖屏短预告：最长边 1280、约 2.5Mbps
 * - 剪辑代理：最长边 1280、约 2Mbps、veryfast（剪映前用，勿上架）
 * 输出默认写到源旁 `_encoded/`（代理档默认 `_proxy/`），不进站点仓库。
 *
 * 用法：
 *   node encode-course-sample.mjs "E:/视频测试/绘画过程片段_原始视频.MOV"
 *   node encode-course-sample.mjs "E:/视频测试/原片.MOV" --preset edit_proxy
 *   node encode-course-sample.mjs "E:/视频测试/原片.MOV" --preset edit_proxy --mute
 *   node encode-course-sample.mjs "E:/视频测试/剪放映剪辑后放小红书.mp4" --preset vert_preview
 *   node encode-course-sample.mjs "...MOV" --t 60   # 只压前 60 秒冒烟
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('缺少输入文件路径');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error('找不到文件:', input);
  process.exit(1);
}

function flag(name, fallback = null) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1] ?? true;
}

const preset = String(flag('--preset', 'land_1080') || 'land_1080');
const tLimit = flag('--t', null);
const muteAudio = args.includes('--mute') || args.includes('--no-audio');
const outExplicit = args.includes('--out');

const profiles = {
  // 注意：ffmpeg 默认会按旋转元数据“摆正”再 scale；iPhone 竖拍常编码为 3840x2160+旋转 → 输出变竖屏。
  land_1080: {
    label: '正课 拟合 1920×1080 框 ~3.5Mbps（1A 请横握拍摄）',
    vf: 'scale=1920:1080:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    vBitrate: '3500k',
    maxrate: '3500k',
    bufsize: '7000k',
    aBitrate: '128k',
    x264Preset: 'medium',
    suffix: 'fit1080_3p5m',
    defaultOutSubdir: '_encoded',
  },
  land_720: {
    label: '正课 拟合 1280×720 框 ~2.0Mbps（省流）',
    vf: 'scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    vBitrate: '2000k',
    maxrate: '2000k',
    bufsize: '4000k',
    aBitrate: '128k',
    x264Preset: 'medium',
    suffix: 'fit720_2m',
    defaultOutSubdir: '_encoded',
  },
  vert_preview: {
    label: '竖屏短预告 最长边1280 ~2.5Mbps',
    vf: "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(ih,iw),min(1280,ih),-2)',scale=trunc(iw/2)*2:trunc(ih/2)*2",
    vBitrate: '2500k',
    maxrate: '2500k',
    bufsize: '5000k',
    aBitrate: '128k',
    x264Preset: 'medium',
    suffix: 'vert1280_2p5m',
    defaultOutSubdir: '_encoded',
  },
  // 剪映前代理：体积小、编码快，方便拖时间轴；画质够剪、不够上架
  edit_proxy: {
    label: '剪辑代理 最长边1280 ~2Mbps · veryfast（仅剪映前用，勿上传 R2）',
    vf: "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(ih,iw),min(1280,ih),-2)',scale=trunc(iw/2)*2:trunc(ih/2)*2",
    vBitrate: '2000k',
    maxrate: '2500k',
    bufsize: '4000k',
    aBitrate: '96k',
    x264Preset: 'veryfast',
    suffix: 'proxy1280_2m',
    defaultOutSubdir: '_proxy',
  },
};

const p = profiles[preset];
if (!p) {
  console.error('未知 --preset，可选:', Object.keys(profiles).join(', '));
  process.exit(1);
}

const outDir = outExplicit
  ? String(flag('--out'))
  : path.join(path.dirname(input), p.defaultOutSubdir || '_encoded');
fs.mkdirSync(outDir, { recursive: true });

const stem = path.basename(input, path.extname(input));
const outName = muteAudio
  ? `${stem}.${p.suffix}.mute.mp4`
  : `${stem}.${p.suffix}.mp4`;
const outPath = path.join(outDir, outName);
const audioArgs = muteAudio
  ? ['-an']
  : ['-c:a', 'aac', '-b:a', p.aBitrate || '128k', '-ac', '2'];
const ff = [
  '-y',
  '-i', input,
  ...(tLimit ? ['-t', String(tLimit)] : []),
  '-vf', p.vf,
  '-c:v', 'libx264',
  '-preset', p.x264Preset || 'medium',
  '-profile:v', 'main',
  '-pix_fmt', 'yuv420p',
  '-b:v', p.vBitrate,
  '-maxrate', p.maxrate,
  '-bufsize', p.bufsize,
  ...audioArgs,
  '-movflags', '+faststart',
  outPath,
];

console.log('[C1]', p.label);
console.log('[C1] in :', input);
console.log('[C1] out:', outPath);
if (muteAudio) console.log('[C1] audio: 已去除（--mute）');
const r = spawnSync('ffmpeg', ff, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('ffmpeg 失败', r.status);
  process.exit(r.status || 1);
}

const probe = spawnSync(
  'ffprobe',
  [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate:stream=codec_name,width,height,bit_rate',
    '-of', 'json',
    outPath,
  ],
  { encoding: 'utf8' },
);
if (probe.status === 0) {
  const j = JSON.parse(probe.stdout);
  const fmt = j.format || {};
  const v = (j.streams || []).find((s) => s.width);
  const dur = Number(fmt.duration || 0);
  const size = Number(fmt.size || 0);
  console.log('[C1] result:', {
    wh: v ? `${v.width}x${v.height}` : '?',
    duration_s: Math.round(dur * 10) / 10,
    size_MB: Math.round((size / 1e6) * 100) / 100,
    mb_per_min: dur > 0 ? Math.round((size / dur) * 60 / 1e6 * 10) / 10 : null,
    bit_rate_Mbps: fmt.bit_rate ? Math.round((Number(fmt.bit_rate) / 1e6) * 100) / 100 : null,
  });
}
console.log('[C1] done');
