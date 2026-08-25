// ==UserScript==
// @name         Sketchfab Model & Texture Dump (Ultimate GLB Version)
// @namespace    Violentmonkey Scripts
// @version      9.9.85
// @description  download sketchfab models as GLB (v9.9.85: Static bone = Diffuse×Tekstura ivory)
// @author       shitposting goddess & krapnik (Mod by Assistant)
// @include      /^https?:\/\/(www\.)?sketchfab\.com\/.*/
// @match        *://*.sketchfab.com/3d-models/**
// @match        *://*.sketchfab.com/models/**
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==
// ================= UI与日志系统 =================
function sfRootDoc() { try { return window.top.document; } catch (e) { return document; } }
var diagLogs = []; function addLog(msg, type="info") { var time = new Date().toLocaleTimeString(); var finalMsg = "[" + time + "] " + msg; diagLogs.push(finalMsg);
var rootDoc = sfRootDoc(); var logBox = rootDoc.getElementById("sf-diag-logs"); if(logBox) { var p = rootDoc.createElement("div");
p.style.color = type === "error" ? "#ff4444" : (type === "warn" ? "#ffaa00" : (type === "success" ? "#00ffcc" : (type === "api" ? "#ff00ff" : "#e0e0e0")));
p.style.fontSize = "12px"; p.style.borderBottom = "1px solid #333"; p.style.padding = "2px 0"; p.innerText = finalMsg; logBox.appendChild(p);
logBox.scrollTop = logBox.scrollHeight; } console.log("[Diag]", msg); }
function initUIPanel() { 
var rootDoc = sfRootDoc(); 
if(rootDoc.getElementById("sf-diag-panel")) return; 
if (!rootDoc.body) { setTimeout(initUIPanel, 50); return; }
var panel = rootDoc.createElement("div"); 
panel.id = "sf-diag-panel";
panel.style.cssText = "position:fixed; top:10px; right:10px; width:500px; background:rgba(20,20,20,0.95); border:1px solid #00ffcc; z-index:999999; border-radius:8px; font-family:sans-serif; color:#fff; overflow:hidden; transition:max-height 0.3s; max-height:85vh; display:flex; flex-direction:column; box-shadow: 0 5px 15px rgba(0,0,0,0.5);"; 
var header = rootDoc.createElement("div"); 
header.style.cssText = "padding:8px; background:#004466; cursor:pointer; font-weight:bold; font-size:14px; display:flex; justify-content:space-between; align-items:center;"; 
header.innerHTML = "<span>🛠️ 完美全能工业级引擎 (v9.9.19 Matcap优先)</span><span id='sf-toggle-btn'>▼</span>";
header.onclick = function() {
if(panel.style.maxHeight === "85vh") { panel.style.maxHeight = "34px"; rootDoc.getElementById('sf-toggle-btn').innerText = "▲"; }
else { panel.style.maxHeight = "85vh"; rootDoc.getElementById('sf-toggle-btn').innerText = "▼"; } };
var btnContainer = rootDoc.createElement("div"); 
btnContainer.style.cssText = "padding:8px; display:flex; flex-direction:column; gap:6px; border-bottom:1px solid #444;"; 
var btnMesh = rootDoc.createElement("button");
btnMesh.id = "sf-btn-mesh"; btnMesh.innerText = "⏳ 等待模型几何体加载..."; btnMesh.style.cssText = "padding:8px; background:#5bc0de; border:none; border-radius:4px; font-weight:bold; cursor:pointer;"; btnMesh.disabled = true;
var btnTex = rootDoc.createElement("button"); 
btnTex.id = "sf-btn-tex"; btnTex.innerText = "⏳ 等待彩色贴图加载..."; btnTex.style.cssText = "padding:8px; background:#f0ad4e; border:none; border-radius:4px; font-weight:bold; cursor:pointer;";
btnTex.disabled = true;
var chkWrapper = rootDoc.createElement("div"); 
chkWrapper.style.cssText = "display:flex; align-items:center; font-size:13px; color:#ddd; padding:4px 0; border-top:1px dashed #555; margin-top:4px;"; 
var chkZUp = rootDoc.createElement("input");
chkZUp.type = "checkbox"; chkZUp.id = "sf-chk-zup"; chkZUp.style.marginRight = "6px"; 
var chkLabel = rootDoc.createElement("label");
chkLabel.htmlFor = "sf-chk-zup"; chkLabel.innerText = "📐 修正模型躺平 (针对 Z-Up 原生模型)"; chkWrapper.appendChild(chkZUp); chkWrapper.appendChild(chkLabel);
var btnCopy = rootDoc.createElement("button"); 
btnCopy.innerText = "📋 复制系统运行日志"; 
btnCopy.style.cssText = "padding:4px; background:#444; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;"; 
btnCopy.onclick = function() {
var text = diagLogs.join('\n'); 
var textArea = rootDoc.createElement("textarea"); 
textArea.value = text; 
rootDoc.body.appendChild(textArea); 
textArea.select();
document.execCommand('copy'); 
rootDoc.body.removeChild(textArea); 
addLog("日志已复制到剪贴板！", "success"); }; 
var logBox = rootDoc.createElement("div");
logBox.id = "sf-diag-logs"; 
logBox.style.cssText = "flex-grow:1; padding:8px; overflow-y:auto; font-family:monospace; height:70vh;";
btnContainer.appendChild(btnMesh); btnContainer.appendChild(btnTex); btnContainer.appendChild(chkWrapper); btnContainer.appendChild(btnCopy); panel.appendChild(header);
panel.appendChild(btnContainer); 
panel.appendChild(logBox); 
rootDoc.body.appendChild(panel); }
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", initUIPanel); } else { initUIPanel(); }
// document-start 时 top.document.body 可能尚未就绪，补一次兜底
try { if (window.top && window.top.document && window.top.document.readyState === "loading") {
window.top.document.addEventListener("DOMContentLoaded", initUIPanel);
} } catch (e) {}
setTimeout(initUIPanel, 800);
unsafeWindow.allmodel = []; unsafeWindow.objects = {}; unsafeWindow.textureIdMap = {}; unsafeWindow._sf_globalBoundTextures = [];
unsafeWindow._sf_flags = { meshReady: false, texturesReady: false, autoExportTriggered: false };
unsafeWindow._sf_auto = { exportWhenReady: true, autoTextureDump: true };
function saveFile(blob, filename) { let url = URL.createObjectURL(blob); let a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
function longestCommonSubstring(s1, s2) { let maxLen = 0; for (let i = 0; i < s1.length; i++) { for (let j = i + 3; j <= s1.length; j++) { let sub = s1.substring(i, j); if (s2.includes(sub) && sub.length > maxLen) { maxLen = sub.length; } } } return maxLen; }
function tryAutoExport(trigger) { let flags = unsafeWindow._sf_flags || {}; let autoCfg = unsafeWindow._sf_auto || {};
if (!autoCfg.exportWhenReady || flags.autoExportTriggered) return;
if (flags.meshReady && flags.texturesReady) {
flags.autoExportTriggered = true;
addLog(`自动化策略触发：贴图与模型均已就绪，开始自动导出GLB（触发源: ${trigger}）。`, "success");
setTimeout(() => {
if (typeof unsafeWindow._sf_doDownload === "function") unsafeWindow._sf_doDownload();
}, 500);
} }
function isNonColorTextureName(n) {
n = String(n || '').toLowerCase();
return /norm|rough|metal|ao|occlu|spec|gloss|cavity|mask|sss|opacity|alpha|bump|height|disp|emiss|metalness|roughness|wimpers/.test(n);
}
function isAlbedoLikeName(n) {
n = String(n || '').toLowerCase();
if (isNonColorTextureName(n)) return false;
return /albedo|base.?color|diffuse|_col|color/.test(n);
}
function triangulateIndices(indices, mode) {
let out = [];
if (!indices || !indices.length) return out;
if (mode === 5) {
for (let j = 0; j + 2 < indices.length; j++) {
if (j % 2 === 0) out.push(indices[j], indices[j + 1], indices[j + 2]);
else out.push(indices[j], indices[j + 2], indices[j + 1]);
}
} else {
for (let j = 0; j < indices.length; j++) out.push(indices[j]);
}
return out;
}
function extractUVFromAttr(attr) {
if (!attr || !attr._elements) return null;
let elements = attr._elements;
let itemSize = attr._itemSize || 2;
let count = attr._numItems || Math.floor(elements.length / itemSize);
if (!count || count < 1) return null;
let normalize = !!attr._normalize;
let div = 1.0;
if (normalize) {
if (elements instanceof Uint16Array) div = 65535.0;
else if (elements instanceof Int16Array) div = 32767.0;
else div = 255.0;
}
let out = new Float32Array(count * 2);
for (let i = 0; i < count; i++) {
let u = elements[i * itemSize];
let v = elements[i * itemSize + 1];
if (normalize) { u = u / div; v = v / div; }
out[i * 2] = u;
out[i * 2 + 1] = v;
}
return { f32: out, itemSize: itemSize, count: count };
}
function getUVSet(uvSets, channel) {
if (!uvSets) return null;
if (uvSets[channel] && uvSets[channel].length >= 4) return uvSets[channel];
for (let i = 0; i <= 8; i++) {
if (uvSets[i] && uvSets[i].length >= 4) return uvSets[i];
}
return null;
}
function computeUvDivisor(uvArray) {
let overOne = 0;
let vals = [];
for (let k = 0; k < uvArray.length; k++) {
let a = Math.abs(uvArray[k]);
vals.push(a);
if (a > 1.01) overOne++;
}
vals.sort(function(a, b) { return a - b; });
let p95 = vals[Math.floor(vals.length * 0.95)] || 0;
let uvDivisor = 1.0;
if (overOne > uvArray.length * 0.08 || p95 > 8.0) {
if (p95 <= 255) uvDivisor = 255.0;
else if (p95 <= 4095) uvDivisor = 4095.0;
else if (p95 <= 65535) uvDivisor = 65535.0;
else uvDivisor = p95;
}
return uvDivisor;
}
function buildNormalizedUV(uvArray, flipV) {
if (flipV === undefined || flipV === null) flipV = true;
let uvDivisor = computeUvDivisor(uvArray);
let f32_uv = new Float32Array(uvArray.length);
for (let k = 0; k < uvArray.length; k += 2) {
f32_uv[k] = uvArray[k] / uvDivisor;
let v = uvArray[k + 1] / uvDivisor;
f32_uv[k + 1] = flipV ? (1.0 - v) : v;
}
return { f32: f32_uv, divisor: uvDivisor, flipV: !!flipV };
}
/* 用底色贴图在 UV 采样点上的局部反差，自动决定是否 flipV。
   Male face：不翻会采到岛外斜纹填充；本头扫模型：一律翻 V 反而木纹。 */
function scoreUvMappingOnAlbedo(uvArray, divisor, flipV, pixels, w, h) {
let nVert = Math.floor(uvArray.length / 2);
if (nVert < 8 || !pixels || w < 8 || h < 8) return -1;
let step = Math.max(1, Math.floor(nVert / 180));
let sumLocal = 0, samples = 0;
for (let vi = 0; vi < nVert; vi += step) {
let u = uvArray[vi * 2] / divisor;
let v0 = uvArray[vi * 2 + 1] / divisor;
let v = flipV ? (1.0 - v0) : v0;
u = u - Math.floor(u); v = v - Math.floor(v);
if (u < 0) u += 1; if (v < 0) v += 1;
let x = Math.min(w - 2, Math.max(1, Math.floor(u * (w - 1))));
let y = Math.min(h - 2, Math.max(1, Math.floor(v * (h - 1))));
function lum(xx, yy) {
let i = (yy * w + xx) * 4;
return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
}
let c = lum(x, y);
let d = Math.abs(c - lum(x + 1, y)) + Math.abs(c - lum(x - 1, y)) + Math.abs(c - lum(x, y + 1)) + Math.abs(c - lum(x, y - 1));
sumLocal += d; samples++;
}
return samples > 0 ? (sumLocal / samples) : -1;
}
function loadBlobToImageData(blob, maxSide) {
return new Promise(function(resolve, reject) {
let img = new Image();
img.onload = function() {
try {
let w = img.naturalWidth || img.width;
let h = img.naturalHeight || img.height;
if (!w || !h) { reject(new Error("empty image")); return; }
let scale = 1;
if (maxSide && Math.max(w, h) > maxSide) scale = maxSide / Math.max(w, h);
let cw = Math.max(1, Math.round(w * scale));
let ch = Math.max(1, Math.round(h * scale));
let c = document.createElement("canvas"); c.width = cw; c.height = ch;
let ctx = c.getContext("2d", { willReadFrequently: true });
ctx.drawImage(img, 0, 0, cw, ch);
resolve({ data: ctx.getImageData(0, 0, cw, ch).data, w: cw, h: ch });
} catch (e) { reject(e); }
};
img.onerror = function() { reject(new Error("image load failed")); };
img.src = URL.createObjectURL(blob);
});
}
function sampleLum(data, w, h, x, y) {
x = Math.max(0, Math.min(w - 1, x | 0));
y = Math.max(0, Math.min(h - 1, y | 0));
let i = (y * w + x) * 4;
return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}
async function scoreAlbedoStreakiness(blob) {
try {
let id = await loadBlobToImageData(blob, 256);
let data = id.data, w = id.w, h = id.h;
let diag = 0, horiz = 0, n = 0;
for (let y = 2; y < h - 2; y += 3) {
for (let x = 2; x < w - 2; x += 3) {
let c = sampleLum(data, w, h, x, y);
diag += Math.abs(c - sampleLum(data, w, h, x + 2, y + 2));
horiz += Math.abs(c - sampleLum(data, w, h, x + 2, y));
n++;
}
}
if (!n) return 0;
return (diag / n) / Math.max(1e-3, (horiz / n));
} catch (e) { return 0; }
}
async function scoreFaceStructure(blob) {
try {
let id = await loadBlobToImageData(blob, 256);
let data = id.data, w = id.w, h = id.h;
let x0 = Math.floor(w * 0.25), x1 = Math.floor(w * 0.75);
let y0 = Math.floor(h * 0.12), y1 = Math.floor(h * 0.62);
let sum = 0, sum2 = 0, dark = 0, n = 0, edge = 0;
for (let y = y0; y < y1; y += 2) {
for (let x = x0; x < x1; x += 2) {
let c = sampleLum(data, w, h, x, y);
sum += c; sum2 += c * c; n++;
if (c < 40) dark++;
edge += Math.abs(c - sampleLum(data, w, h, x + 2, y)) + Math.abs(c - sampleLum(data, w, h, x, y + 2));
}
}
if (!n) return 0;
let mean = sum / n;
let varc = Math.max(0, sum2 / n - mean * mean);
return Math.sqrt(varc) * 0.35 + (dark / n) * 80 + (edge / n) * 0.15;
} catch (e) { return 0; }
}
async function synthesizeAlbedoFromSpecular(specBlob, colourBlob, matcapBlob) {
// v9.9.34 通用：强模糊 Colour 染色（不用 Colour 高频，防斜纹树杈）+ Spec 低频明暗 + Spec 细暗线毛发。
// Spec 暗腔压暗；贴图外 gutter 近黑。不做 alpha 打洞。Matcap 不烘进 albedo。
let cr = 208, cg = 165, cb = 142;
let colourSoftData = null, colourSharpData = null, colourSoftW = 0, colourSoftH = 0;
if (colourBlob) {
try {
let imgC = await new Promise(function(resolve, reject) {
let im = new Image();
im.onload = function() { resolve(im); };
im.onerror = function() { reject(new Error("colour load failed")); };
im.src = URL.createObjectURL(colourBlob);
});
let csw = imgC.naturalWidth || imgC.width, csh = imgC.naturalHeight || imgC.height;
let cMax = 768;
let csc = Math.min(1, cMax / Math.max(csw, csh));
colourSoftW = Math.max(1, Math.round(csw * csc));
colourSoftH = Math.max(1, Math.round(csh * csc));
let ccan = document.createElement("canvas"); ccan.width = colourSoftW; ccan.height = colourSoftH;
let cctx = ccan.getContext("2d", { willReadFrequently: true });
cctx.filter = "blur(16px)";
cctx.drawImage(imgC, 0, 0, colourSoftW, colourSoftH);
cctx.filter = "none";
colourSoftData = cctx.getImageData(0, 0, colourSoftW, colourSoftH).data;
// 高频细节层：鬓角发丝/雀斑在 Sketchfab 里来自 Colour，不能只留 16px 糊底
cctx.clearRect(0, 0, colourSoftW, colourSoftH);
cctx.filter = "blur(1.5px)";
cctx.drawImage(imgC, 0, 0, colourSoftW, colourSoftH);
cctx.filter = "none";
colourSharpData = cctx.getImageData(0, 0, colourSoftW, colourSoftH).data;
let n0 = 0, r0 = 0, g0 = 0, b0 = 0, chromaAcc = 0;
for (let i = 0; i < colourSoftData.length; i += 16) {
r0 += colourSoftData[i]; g0 += colourSoftData[i + 1]; b0 += colourSoftData[i + 2]; n0++;
let m = (colourSoftData[i] + colourSoftData[i + 1] + colourSoftData[i + 2]) / 3;
chromaAcc += Math.abs(colourSoftData[i] - m) + Math.abs(colourSoftData[i + 1] - m) + Math.abs(colourSoftData[i + 2] - m);
}
if (n0) {
cr = r0 / n0; cg = g0 / n0; cb = b0 / n0;
if ((chromaAcc / n0) < 12) { cr = 214; cg = 168; cb = 142; colourSoftData = null; colourSharpData = null; }
}
} catch (e) { colourSoftData = null; colourSharpData = null; }
}
if (matcapBlob) {
try {
let mid = await loadBlobToImageData(matcapBlob, 96);
let md = mid.data, mw = mid.w, mh = mid.h, cx = (mw - 1) * 0.5, cy = (mh - 1) * 0.5, R = Math.min(cx, cy);
let r = 0, g = 0, b = 0, n = 0;
for (let y = 0; y < mh; y += 2) for (let x = 0; x < mw; x += 2) {
let d = Math.hypot(x - cx, y - cy) / Math.max(1e-3, R);
if (d < 0.28 || d > 0.62) continue;
let i = (y * mw + x) * 4; r += md[i]; g += md[i + 1]; b += md[i + 2]; n++;
}
if (n > 8) {
cr = cr * 0.82 + (r / n) * 0.18;
cg = cg * 0.82 + (g / n) * 0.18;
cb = cb * 0.82 + (b / n) * 0.18;
}
} catch (e) {}
}
let img = await new Promise(function(resolve, reject) {
let im = new Image();
im.onload = function() { resolve(im); };
im.onerror = function() { reject(new Error("spec load failed")); };
im.src = URL.createObjectURL(specBlob);
});
let sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
let maxSide = 1536;
let scale = Math.min(1, maxSide / Math.max(sw, sh));
let w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
let canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
let ctx = canvas.getContext("2d", { willReadFrequently: true });
ctx.drawImage(img, 0, 0, w, h);
let sharp = ctx.getImageData(0, 0, w, h);
let shd = sharp.data;
ctx.clearRect(0, 0, w, h);
ctx.filter = "blur(18px)";
ctx.drawImage(img, 0, 0, w, h);
ctx.filter = "none";
let soft = ctx.getImageData(0, 0, w, h);
let sd = soft.data;
let ys = [];
for (let i = 0; i < sd.length; i += 4) {
let y = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
let ys0 = 0.299 * shd[i] + 0.587 * shd[i + 1] + 0.114 * shd[i + 2];
if (ys0 > 4) ys.push(y);
}
ys.sort(function(a, b) { return a - b; });
let p8 = ys[Math.floor(ys.length * 0.08)] || 8;
let p92 = ys[Math.floor(ys.length * 0.92)] || 55;
let out = ctx.createImageData(w, h);
for (let i = 0; i < sd.length; i += 4) {
let ySharp = 0.299 * shd[i] + 0.587 * shd[i + 1] + 0.114 * shd[i + 2];
let y = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
let px = (i / 4) % w, py = Math.floor((i / 4) / w);
let pr = cr, pg = cg, pb = cb;
if (colourSoftData && colourSoftW > 0) {
let cx = Math.min(colourSoftW - 1, Math.max(0, Math.round(px / w * (colourSoftW - 1))));
let cy = Math.min(colourSoftH - 1, Math.max(0, Math.round(py / h * (colourSoftH - 1))));
let ci = (cy * colourSoftW + cx) * 4;
// v9.9.36：软 Colour 弱染色；毛发=Colour mid 更暗 ∩ Spec 暗
pr = cr * 0.92 + colourSoftData[ci] * 0.08;
pg = cg * 0.92 + colourSoftData[ci + 1] * 0.08;
pb = cb * 0.92 + colourSoftData[ci + 2] * 0.08;
}
{
let cLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
if (cLum < 105 && y < p8 * 1.85) {
pr = Math.min(255, pr * 0.82 + 10);
pg = Math.min(255, pg * 0.76 + 7);
pb = Math.min(255, pb * 0.72 + 5);
} else {
let mean = (pr + pg + pb) / 3;
pr = mean * 0.68 + pr * 0.32;
pg = mean * 0.68 + pg * 0.32;
pb = mean * 0.68 + pb * 0.32;
pr = Math.min(255, pr * 0.35 + 186 * 0.65);
pg = Math.min(255, pg * 0.35 + 168 * 0.65);
pb = Math.min(255, pb * 0.32 + 166 * 0.68);
let u = (y - p8) / Math.max(1e-3, p92 - p8);
u = Math.max(0, Math.min(1, u));
let flush = 4 * u * (1 - u);
pr = Math.min(255, pr + flush * 12);
pg = Math.min(255, pg + flush * 5);
pb = Math.min(255, pb + flush * 9);
}
}
if (colourSoftData && colourSoftW > 0) {
let cx2 = Math.min(colourSoftW - 1, Math.max(0, Math.round(px / w * (colourSoftW - 1))));
let cy2 = Math.min(colourSoftH - 1, Math.max(0, Math.round(py / h * (colourSoftH - 1))));
let ci2 = (cy2 * colourSoftW + cx2) * 4;
let sR = colourSoftData[ci2], sG = colourSoftData[ci2 + 1], sB = colourSoftData[ci2 + 2];
sL = 0.299 * sR + 0.587 * sG + 0.114 * sB;
// v9.9.71：取消 Colour 软暗铺毛发（易脏斑）；眉睫改几何近眼喷涂
if (ySharp <= 0.35) {
out.data[i] = Math.min(255, 120 + pr * 0.25);
out.data[i + 1] = Math.min(255, 108 + pg * 0.22);
out.data[i + 2] = Math.min(255, 100 + pb * 0.20);
out.data[i + 3] = 255;
continue;
}
}
// v9.9.37：Spec 只轻微提亮，不再按暗腔压暗
let t = (y - p8) / Math.max(1e-3, p92 - p8);
t = Math.max(0, Math.min(1, t));
t = t * t * (3 - 2 * t);
let lum = 0.98 + 0.16 * t;
out.data[i] = Math.min(255, pr * lum);
out.data[i + 1] = Math.min(255, pg * lum);
out.data[i + 2] = Math.min(255, pb * lum);
out.data[i + 3] = 255;
}
ctx.putImageData(out, 0, 0);
return await new Promise(function(resolve, reject) {
canvas.toBlob(function(b) { if (b) resolve(b); else reject(new Error("synth albedo failed")); }, "image/jpeg", 0.92);
});
}
async function synthesizeEyeballAlbedo(irisRgb) {
irisRgb = irisRgb || [0.22, 0.28, 0.34];
let size = 512;
let canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
let ctx = canvas.getContext("2d", { willReadFrequently: true });
let img = ctx.createImageData(size, size);
// 瞳孔中心略上移：开孔里不至于只露出下半虹膜
let cx = (size - 1) * 0.5, cy = (size - 1) * 0.5, R = size * 0.48;
let ir = irisRgb[0] * 255, ig = irisRgb[1] * 255, ib = irisRgb[2] * 255;
let hx = -0.12, hy = -0.18, hr = 0.07;
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
let dx = (x - cx) / R, dy = (y - cy) / R;
let d = Math.hypot(dx, dy);
let i = (y * size + x) * 4;
let ang = Math.atan2(dy, dx);
let fiber = 0.78 + 0.22 * Math.sin(ang * 22.0 + d * 10.0) * Math.sin(ang * 6.0);
let r = 8, g = 6, b = 5;
if (d > 0.96) {
r = 38; g = 27; b = 23;
} else if (d < 0.30) {
// 瞳孔：开孔中心必须能读出黑点
let k = d / 0.30;
r = 3 + 10 * k; g = 2 + 8 * k; b = 2 + 8 * k;
} else if (d < 0.72) {
let t = (d - 0.30) / 0.42;
let limbus = t > 0.78 ? (1 - (t - 0.78) / 0.22) * 0.45 + 0.55 : 1;
let shade = (0.78 + 0.22 * fiber) * limbus * (0.88 + 0.18 * (1 - t));
r = Math.min(255, ir * shade);
g = Math.min(255, ig * shade);
b = Math.min(255, ib * shade * 1.04);
} else {
let t = Math.min(1, (d - 0.72) / 0.24);
let vein = 0.97 + 0.03 * Math.sin(ang * 8 + d * 20);
let sr = 105 * vein, sg = 96 * vein, sb = 90 * vein;
r = sr * (1 - t) + 38 * t;
g = sg * (1 - t) + 27 * t;
b = sb * (1 - t) + 23 * t;
}
// 湿润高光点
let hd = Math.hypot(dx - hx, dy - hy);
if (hd < hr && d < 0.72) {
let w = 1 - hd / hr;
w = w * w;
r = Math.min(255, r + (165 - r) * w * 0.28);
g = Math.min(255, g + (172 - g) * w * 0.28);
b = Math.min(255, b + (178 - b) * w * 0.28);
}
img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
}
ctx.putImageData(img, 0, 0);
return await new Promise(function(resolve, reject) {
canvas.toBlob(function(b) { if (b) resolve(b); else reject(new Error("eyeball albedo failed")); }, "image/jpeg", 0.92);
});
}
function buildSphericalUVsFromPositions(vertexF32, normalF32) {
// 通用：近隐无 UV 眼球 → 法线定朝向平面 UV；软钳防平铺
let n = vertexF32.length / 3;
let pos = vertexF32, nrm = normalF32;
let c0 = [pos[0], pos[1], pos[2]], c1 = [pos[0], pos[1], pos[2]];
let maxD = -1;
for (let i = 0; i < n; i++) {
let d = Math.hypot(pos[i * 3] - c0[0], pos[i * 3 + 1] - c0[1], pos[i * 3 + 2] - c0[2]);
if (d > maxD) { maxD = d; c1 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; }
}
for (let iter = 0; iter < 8; iter++) {
let s0 = [0, 0, 0], s1 = [0, 0, 0], n0 = 0, n1 = 0;
for (let i = 0; i < n; i++) {
let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
let d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
let d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
if (d0 <= d1) { s0[0] += x; s0[1] += y; s0[2] += z; n0++; }
else { s1[0] += x; s1[1] += y; s1[2] += z; n1++; }
}
if (n0) c0 = [s0[0] / n0, s0[1] / n0, s0[2] / n0];
if (n1) c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1];
}
function fyCross(a, b) {
let x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
let L = Math.hypot(x, y, z) || 1;
return [x / L, y / L, z / L];
}
function fwdOf(c, other) {
let sx = 0, sy = 0, sz = 0, k = 0;
for (let i = 0; i < n; i++) {
let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
let d = Math.hypot(x - c[0], y - c[1], z - c[2]);
let dO = Math.hypot(x - other[0], y - other[1], z - other[2]);
if (d > dO) continue;
if (nrm) { sx += nrm[i * 3]; sy += nrm[i * 3 + 1]; sz += nrm[i * 3 + 2]; k++; }
}
let fx = sx, fy = sy, fz = sz;
let fl = Math.hypot(fx, fy, fz);
if (k < 8 || fl < 1e-6) { fx = 0; fy = 0; fz = 1; }
else { fx /= fl; fy /= fl; fz /= fl; }
return [fx, fy, fz];
}
function pack(c, other) {
let fwd = fwdOf(c, other);
let ux = 0, uy = 1, uz = 0;
if (Math.abs(fwd[1]) > 0.9) { ux = 1; uy = 0; uz = 0; }
let rx = uy * fwd[2] - uz * fwd[1], ry = uz * fwd[0] - ux * fwd[2], rz = ux * fwd[1] - uy * fwd[0];
let rl = Math.hypot(rx, ry, rz) || 1;
rx /= rl; ry /= rl; rz /= rl;
let up = fyCross(fwd, [rx, ry, rz]);
ux = up[0]; uy = up[1]; uz = up[2];
let dots = [];
for (let i = 0; i < n; i++) {
let x = pos[i * 3] - c[0], y = pos[i * 3 + 1] - c[1], z = pos[i * 3 + 2] - c[2];
if (Math.hypot(x, y, z) > 0.55) continue;
dots.push({ i: i, pr: x * fwd[0] + y * fwd[1] + z * fwd[2] });
}
dots.sort(function(a, b) { return b.pr - a.pr; });
let top = dots.slice(0, Math.max(24, Math.floor(dots.length * 0.10)));
let ox = 0, oy = 0, oz = 0;
for (let qi = 0; qi < top.length; qi++) {
let q = top[qi];
ox += pos[q.i * 3]; oy += pos[q.i * 3 + 1]; oz += pos[q.i * 3 + 2];
}
ox /= top.length; oy /= top.length; oz /= top.length;
let rs = top.map(function(q) {
let x = pos[q.i * 3] - ox, y = pos[q.i * 3 + 1] - oy, z = pos[q.i * 3 + 2] - oz;
return Math.hypot(x * rx + y * ry + z * rz, x * ux + y * uy + z * uz);
}).sort(function(a, b) { return a - b; });
let eyeRad = rs[Math.floor(rs.length * 0.5)] || 0.22;
let rad = eyeRad * 0.42;
return { ox: ox, oy: oy, oz: oz, rad: rad, rx: rx, ry: ry, rz: rz, ux: ux, uy: uy, uz: uz, fwd: fwd };
}
let p0 = pack(c0, c1), p1 = pack(c1, c0);
let uvs = new Float32Array(n * 2);
for (let i = 0; i < n; i++) {
let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
let d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
let d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
let p = d0 <= d1 ? p0 : p1;
let dx = x - p.ox, dy = y - p.oy, dz = z - p.oz;
let ru = (dx * p.rx + dy * p.ry + dz * p.rz) / (2 * p.rad);
let rv = -(dx * p.ux + dy * p.uy + dz * p.uz) / (2 * p.rad);
let rd = Math.hypot(ru, rv);
if (rd > 0.40) { let s = 0.40 / rd; ru *= s; rv *= s; }
uvs[i * 2] = 0.5 + ru;
uvs[i * 2 + 1] = 0.5 + rv;
}
function recenterCluster(c, other, fwd) {
let su = 0, sv = 0, sk = 0;
for (let i = 0; i < n; i++) {
let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
let d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
let d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
let inC = (c === c0) ? d0 <= d1 : d1 < d0;
if (!inC) continue;
if (nrm) {
let nd = nrm[i * 3] * fwd[0] + nrm[i * 3 + 1] * fwd[1] + nrm[i * 3 + 2] * fwd[2];
if (nd < 0.32) continue;
}
let u = uvs[i * 2], v = uvs[i * 2 + 1];
if (Math.hypot(u - 0.5, v - 0.5) > 0.38) continue;
su += u; sv += v; sk++;
}
if (sk < 12) return;
let du = 0.5 - su / sk, dv = 0.5 - sv / sk;
for (let i = 0; i < n; i++) {
let d0 = Math.hypot(pos[i * 3] - c0[0], pos[i * 3 + 1] - c0[1], pos[i * 3 + 2] - c0[2]);
let d1 = Math.hypot(pos[i * 3] - c1[0], pos[i * 3 + 1] - c1[1], pos[i * 3 + 2] - c1[2]);
let inC = (c === c0) ? d0 <= d1 : d1 < d0;
if (!inC) continue;
uvs[i * 2] += du;
uvs[i * 2 + 1] += dv;
}
}
recenterCluster(c0, c1, p0.fwd);
recenterCluster(c1, c0, p1.fwd);
return uvs;
}
async function chooseFlipVForAlbedo(uvArray, albedoBlob) {
// v9.9.12+：始终 flipV。矩阵验证对 Sketchfab 导出 UV 与贴图对齐更稳；自适应曾在斜纹 Diffuse 上误判。
return { flipV: true, scoreFlip: -1, scoreNo: -1, reason: "always_flipV", ratio: 0 };
}
// ================= 原生纯 JS GLB 构建器 =================
async function buildGLB(models, texturesMap, fixZUp = false) { addLog(`--> 1/3: 启动【究极统计算法装配引擎】${fixZUp ? '(已开启 Z-Up 矫正)' : ''}...`, "info");
let json = { asset: { version: "2.0", generator: "Sketchfab Ultimate Engine v9.9.2" },
scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] }; let binBuffers = []; let currentOffset = 0; let rootNodeIdx = -1;
if (fixZUp) { json.nodes.push({ name: "Sketchfab_ZUp_Correction_Root", rotation: [-0.7071067811865475, 0, 0, 0.7071067811865476], children: [] }); rootNodeIdx = json.nodes.length - 1; json.scenes[0].nodes.push(rootNodeIdx);
addLog(`[姿态修正] 用户开启物理正骨，植入 -90度 X轴翻转矩阵！`, "warn"); }
function addBufferView(data, target) { let u8; if (data instanceof ArrayBuffer) { u8 = new Uint8Array(data); } else if (data && data.buffer instanceof ArrayBuffer) { u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); } else { u8 = new Uint8Array(data); }
let byteLength = u8.length; let padding = (4 - (byteLength % 4)) % 4; let paddedU8 = new Uint8Array(byteLength + padding); paddedU8.set(u8);
let view = { buffer: 0, byteOffset: currentOffset, byteLength: byteLength }; if (target !== undefined) view.target = target; json.bufferViews.push(view); binBuffers.push(paddedU8); currentOffset += paddedU8.length; return json.bufferViews.length - 1; }
function addAccessor(bufferViewIdx, componentType, count, type, min, max) { let acc = { bufferView: bufferViewIdx, componentType: componentType, count: count, type: type }; if (min) acc.min = min; if (max) acc.max = max; json.accessors.push(acc); return json.accessors.length - 1; }
async function mergeAlbedoAndOpacity(albedoBlob, opacityBlob, rgbScale, alphaScale) {
rgbScale = (rgbScale === undefined || rgbScale === null) ? 1 : Number(rgbScale);
alphaScale = (alphaScale === undefined || alphaScale === null) ? 1 : Number(alphaScale);
return new Promise((resolve, reject) => {
let imgA = new Image(); let imgO = new Image(); let loadedA = false, loadedO = false;
let checkDone = () => { if (!(loadedA && loadedO)) return;
try {
let canvas = document.createElement('canvas'); canvas.width = imgA.width; canvas.height = imgA.height;
let ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.drawImage(imgA, 0, 0); let imgDataA = ctx.getImageData(0, 0, canvas.width, canvas.height);
let canvasO = document.createElement('canvas'); canvasO.width = canvas.width; canvasO.height = canvas.height;
let ctxO = canvasO.getContext('2d', { willReadFrequently: true });
ctxO.drawImage(imgO, 0, 0, canvas.width, canvas.height); let imgDataO = ctxO.getImageData(0, 0, canvas.width, canvas.height);
for (let i = 0; i < imgDataA.data.length; i += 4) {
imgDataA.data[i] = Math.max(0, Math.min(255, Math.round(imgDataA.data[i] * rgbScale)));
imgDataA.data[i + 1] = Math.max(0, Math.min(255, Math.round(imgDataA.data[i + 1] * rgbScale)));
imgDataA.data[i + 2] = Math.max(0, Math.min(255, Math.round(imgDataA.data[i + 2] * rgbScale)));
imgDataA.data[i + 3] = Math.max(0, Math.min(255, Math.round(imgDataO.data[i] * alphaScale)));
}
ctx.putImageData(imgDataA, 0, 0);
canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("Blob失败")); }, "image/png");
} catch (e) { reject(e); }
};
imgA.onload = () => { loadedA = true; checkDone(); }; imgO.onload = () => { loadedO = true; checkDone(); };
imgA.onerror = reject; imgO.onerror = reject;
imgA.src = URL.createObjectURL(albedoBlob); imgO.src = URL.createObjectURL(opacityBlob);
});
}
// glTF：metallicRoughnessTexture 的 G=粗糙度、B=金属度
async function packMetallicRoughness(metalBlob, roughBlob) {
return new Promise((resolve, reject) => {
let hasM = !!metalBlob; let hasR = !!roughBlob;
if (!hasM && !hasR) { resolve(null); return; }
let imgM = new Image(); let imgR = new Image();
let need = (hasM ? 1 : 0) + (hasR ? 1 : 0); let got = 0;
let done = () => {
got++;
if (got < need) return;
try {
let w = hasM ? imgM.naturalWidth : imgR.naturalWidth;
let h = hasM ? imgM.naturalHeight : imgR.naturalHeight;
if (hasR) { w = Math.max(w, imgR.naturalWidth); h = Math.max(h, imgR.naturalHeight); }
let metalData = null; let roughData = null;
if (hasM) {
let cM = document.createElement("canvas"); cM.width = w; cM.height = h;
let xM = cM.getContext("2d", { willReadFrequently: true }); xM.drawImage(imgM, 0, 0, w, h);
metalData = xM.getImageData(0, 0, w, h).data;
}
if (hasR) {
let cR = document.createElement("canvas"); cR.width = w; cR.height = h;
let xR = cR.getContext("2d", { willReadFrequently: true }); xR.drawImage(imgR, 0, 0, w, h);
roughData = xR.getImageData(0, 0, w, h).data;
}
let canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
let ctx = canvas.getContext("2d", { willReadFrequently: true });
let out = ctx.createImageData(w, h);
for (let i = 0; i < out.data.length; i += 4) {
out.data[i] = 255;
out.data[i + 1] = roughData ? roughData[i] : 255;
out.data[i + 2] = metalData ? metalData[i] : 0;
out.data[i + 3] = 255;
}
ctx.putImageData(out, 0, 0);
canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("MR打包失败")); }, "image/png");
} catch (e) { reject(e); }
};
if (hasM) { imgM.onload = done; imgM.onerror = reject; imgM.src = URL.createObjectURL(metalBlob); }
if (hasR) { imgR.onload = done; imgR.onerror = reject; imgR.src = URL.createObjectURL(roughBlob); }
});
}
let localOriginTextureArr = []; let apiMatConfig = {}; if (unsafeWindow.prefetchedData) {
let texKeys = Object.keys(unsafeWindow.prefetchedData).filter(k => k.includes('/textures'));
let texMerged = {};
for (let tk = 0; tk < texKeys.length; tk++) {
let arr = unsafeWindow.prefetchedData[texKeys[tk]].results || [];
for (let ti = 0; ti < arr.length; ti++) { if (arr[ti] && arr[ti].uid) texMerged[arr[ti].uid] = arr[ti]; }
}
localOriginTextureArr = Object.values(texMerged);
let modelKeys = Object.keys(unsafeWindow.prefetchedData).filter(k => k.includes('/models/') && !k.includes('?')); if (modelKeys.length > 0) {
let coreResults = unsafeWindow.prefetchedData[modelKeys[0]].results || unsafeWindow.prefetchedData[modelKeys[0]]; let rawMats = coreResults.materials || (coreResults.options && coreResults.options.materials); if (rawMats) {
let matArray = Array.isArray(rawMats) ? rawMats : Object.values(rawMats); matArray.forEach(m => { let config = { name: m.name || m.id, channels: {}, alphaMode: "OPAQUE", _raw: m }; if (m.channels) {
let bestScore = -1; let c_color = [1, 1, 1]; let c_uid = null; let c_factor = 1.0; let c_texCoord = 0; let candidates = ['DiffusePBR', 'AlbedoPBR', 'DiffuseColor'];
for (let i = 0; i < candidates.length; i++) { let chName = candidates[i]; let ch = m.channels[chName]; if (ch && ch.enable !== false) { let score = 10 - i; if (ch.texture && ch.texture.uid) { score += 1000; }
if (ch.color && (ch.color[0] < 0.99 || ch.color[1] < 0.99 || ch.color[2] < 0.99)) { score += 100; }
if (ch.factor !== undefined && ch.factor !== 1.0) { score += 100; }
if (score > bestScore) { bestScore = score; c_uid = (ch.texture && ch.texture.uid) ? ch.texture.uid : null; c_texCoord = (ch.texture && ch.texture.texCoord !== undefined) ? ch.texture.texCoord : 0; c_color = ch.color || [1, 1, 1];
c_factor = ch.factor !== undefined ? ch.factor : 1.0; } } }
config.channels.albedoUid = c_uid; config.channels.albedoTexCoord = c_texCoord; config.channels.albedoFactor = c_factor;
config.channels.albedoColor = [c_color[0] * c_factor, c_color[1] * c_factor, c_color[2] * c_factor];
let specCh = m.channels.SpecularPBR || m.channels.SpecularF0 || m.channels.SpecularColor;
if (specCh && specCh.enable !== false && specCh.texture && specCh.texture.uid) config.channels.specularUid = specCh.texture.uid;
let matcapCh = m.channels.Matcap;
if (matcapCh && matcapCh.enable !== false && matcapCh.texture && matcapCh.texture.uid) config.channels.matcapUid = matcapCh.texture.uid;
let normCh = m.channels.NormalMap; if (normCh && normCh.enable !== false && normCh.texture) { config.channels.normalUid = normCh.texture.uid; if(normCh.factor !== undefined) config.channels.normalFactor = normCh.factor; }
let aoCh = m.channels.AOPBR; if (aoCh && aoCh.enable !== false && aoCh.texture) { config.channels.aoUid = aoCh.texture.uid; if(aoCh.factor !== undefined) config.channels.aoFactor = aoCh.factor; }
let roughCh = m.channels.RoughnessPBR || m.channels.GlossinessPBR;
if (roughCh && roughCh.enable !== false) {
if (roughCh.factor !== undefined) config.channels.roughnessFactor = roughCh.factor;
if (roughCh.texture && roughCh.texture.uid) config.channels.roughnessUid = roughCh.texture.uid;
}
let metalCh = m.channels.MetalnessPBR;
if (metalCh && metalCh.enable !== false) {
if (metalCh.factor !== undefined) config.channels.metallicFactor = metalCh.factor;
if (metalCh.texture && metalCh.texture.uid) config.channels.metalnessUid = metalCh.texture.uid;
}
// ClearCoat：玻璃高光壳（与模型名无关，按通道通用识别）
let ccCh = m.channels.ClearCoat;
if (ccCh && ccCh.enable !== false && ccCh.factor !== undefined) config.channels.clearcoatFactor = ccCh.factor;
let ccRoughCh = m.channels.ClearCoatRoughness;
if (ccRoughCh && ccRoughCh.enable !== false && ccRoughCh.factor !== undefined) config.channels.clearcoatRoughness = ccRoughCh.factor;
let opacCh = m.channels.Opacity; if (opacCh && opacCh.enable !== false) {
config.channels.opacityType = opacCh.type || "blend";
config.channels.opacityIor = opacCh.ior;
config.channels.opacityInvert = !!opacCh.invert;
config.channels.opacityRoughness = (opacCh.roughnessFactor !== undefined) ? opacCh.roughnessFactor : null;
let opacType = String(opacCh.type || "").toLowerCase();
let opacFactor = (opacCh.factor !== undefined) ? Number(opacCh.factor) : 1;
let opacIor = (opacCh.ior !== undefined && opacCh.ior !== null) ? Number(opacCh.ior) : null;
// 通用玻璃壳（勿把「近隐无贴图层」强行做成浅色玻璃——无虹膜贴图时会在眼窝发白光）：
// 1) additive 折射层
// 2) 极低 alphaBlend + IOR（角膜外壳，与眼睛模型同一规则）
let isGlassOpac = (opacType === "additive") ||
((opacType === "alphablend" || opacType === "blend") && opacFactor <= 0.2 && opacIor !== null && opacIor > 1.01);
if (isGlassOpac) {
config.isGlass = true;
config.glassDetect = (opacType === "additive") ? "additive" : ("alphaBlend+ior@" + opacFactor);
// additive 常用 factor=1；alphaBlend+IOR 低 factor → 满透射角膜
config.channels.transmissionFactor = (opacType === "additive")
? ((opacCh.factor !== undefined) ? Number(opacCh.factor) : 1)
: 1;
if (opacCh.texture && opacCh.texture.uid) config.channels.transmissionUid = opacCh.texture.uid;
config.alphaMode = "OPAQUE";
// 玻璃默认要有清漆高光，才能看出「突出的玻璃壳」
if (config.channels.clearcoatFactor === undefined) config.channels.clearcoatFactor = 1;
if (config.channels.clearcoatRoughness === undefined) {
config.channels.clearcoatRoughness = (config.channels.opacityRoughness !== null && config.channels.opacityRoughness !== undefined)
? Number(config.channels.opacityRoughness) : 0.04;
}
} else {
if (opacCh.texture) { config.channels.opacityUid = opacCh.texture.uid; config.alphaMode = "BLEND"; }
config.channels.opacityFactor = opacCh.factor !== undefined ? opacCh.factor : 1;
if (config.channels.opacityFactor < 0.95) config.alphaMode = "BLEND";
// 近隐无贴图球体（常见于眼球）：不要导出成 2% 透明石膏眼窝。有 Matcap 的模型里按实心眼球处理。
if (!config.channels.albedoUid && !config.channels.opacityUid && Number(config.channels.opacityFactor) < 0.08) {
config.sfEyeball = true;
config.alphaMode = "OPAQUE";
config.channels.opacityFactor = 1;
addLog(`[眼球层] ${config.name}: 近隐无贴图 → 实心眼球 extras.sfEyeball`, "info");
}
}
}
apiMatConfig[config.name] = config; if (m.id) apiMatConfig[m.id] = config; } }); } } }
function getTexNameByUid(uid) { if (!uid) return null; let tex = localOriginTextureArr.find(t => t.uid === uid); return tex ? tex.name : null; }
function resolveApiConfig(matName) {
if (!matName) return null;
if (apiMatConfig[matName]) return apiMatConfig[matName];
let clean = String(matName).toLowerCase().replace(/[^a-z0-9]/g, '');
let best = null; let bestScore = 0;
for (let k in apiMatConfig) {
let kc = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
if (!kc || !clean) continue;
if (kc === clean) return apiMatConfig[k];
let score = longestCommonSubstring(clean, kc);
if (score > bestScore) { bestScore = score; best = apiMatConfig[k]; }
}
return bestScore >= 3 ? best : null;
}
addLog(`--> 执行高级材质预处理 (透明度合并验证)...`, "info");
for (let mKey in apiMatConfig) {
let config = apiMatConfig[mKey];
// 打包金属度/粗糙度贴图（缺贴图却 metallicFactor=1 时，无环境光会整片发黑）
let metalName = getTexNameByUid(config.channels.metalnessUid);
let roughName = getTexNameByUid(config.channels.roughnessUid);
let metalBlob = (metalName && texturesMap[metalName]) ? texturesMap[metalName] : null;
let roughBlob = (roughName && texturesMap[roughName]) ? texturesMap[roughName] : null;
if (metalBlob || roughBlob) {
try {
let packed = await packMetallicRoughness(metalBlob, roughBlob);
if (packed) {
let packName = `packed_mr_${config.name || mKey}.png`.replace(/[^\w.\-]+/g, "_");
texturesMap[packName] = packed;
config.packedMRName = packName;
addLog(`[MR打包] ${config.name}: metal=${metalName || "无"} rough=${roughName || "无"} -> ${packName}`, "success");
}
} catch (e) { addLog(`[MR打包失败] ${config.name}: ${e.message || e}`, "warn"); }
} else if (config.channels.metallicFactor !== undefined && Number(config.channels.metallicFactor) > 0.35 && !config.isGlass) {
// 无金属度贴图却 factor 很高：管理器无 IBL 时会变成黑金属，降到非金属
config.channels.metallicFactor = 0;
addLog(`[金属度保护] ${config.name}: 无金属度贴图，metallicFactor 强制为 0，避免黑球`, "warn");
}
// 玻璃/折射材质：不走普通 alpha 合并（避免黑底色+白遮罩变成实心黑/雾片）
if (config.isGlass) {
addLog(`[玻璃材质] ${config.name}: ${config.glassDetect || "glass"} → transmission+clearcoat`, "success");
continue;
}
if (!config.channels.opacityUid) continue;
let albName = getTexNameByUid(config.channels.albedoUid);
let opcName = getTexNameByUid(config.channels.opacityUid);
if (!opcName || !texturesMap[opcName]) continue;
// 关键：即使 Albedo 槽挂的是 Opacity 灰图（如 blinn7 睫毛），也要与 Opacity 遮罩合并；禁止再误绑成外眼 Base_Color
let rgbBlob = (albName && texturesMap[albName]) ? texturesMap[albName] : null;
if (!rgbBlob) {
// 无底色贴图时：用 Diffuse/白 做 RGB，Opacity 做 A（普通半透明，非玻璃）
try {
let solidCanvasDone = false;
let rgb = config.channels.albedoColor || [1, 1, 1];
// 若底色是纯黑但有透明遮罩，用白以免变成“实心黑片”
if ((rgb[0] + rgb[1] + rgb[2]) < 0.05) rgb = [1, 1, 1];
let c = document.createElement("canvas"); c.width = 4; c.height = 4;
let cx = c.getContext("2d"); cx.fillStyle = `rgb(${Math.round(rgb[0]*255)},${Math.round(rgb[1]*255)},${Math.round(rgb[2]*255)})`; cx.fillRect(0,0,4,4);
rgbBlob = await new Promise((res) => c.toBlob(res, "image/png"));
} catch (e) { continue; }
}
let rgbScale = (config.channels.albedoFactor !== undefined && config.channels.albedoFactor !== null) ? Number(config.channels.albedoFactor) : 1;
let alphaScale = (config.channels.opacityFactor !== undefined && config.channels.opacityFactor !== null) ? Number(config.channels.opacityFactor) : 1;
try {
let mergedBlob = await mergeAlbedoAndOpacity(rgbBlob, texturesMap[opcName], rgbScale, alphaScale);
let newName = `merged_alpha_${String(opcName).replace(/\.(jpg|jpeg|png)$/i, '')}__${String(albName || 'solid').replace(/\.(jpg|jpeg|png)$/i, '')}.png`;
texturesMap[newName] = mergedBlob;
config.mergedAlbedoName = newName;
config.alphaMode = /wimper|lash|cilia/i.test(opcName) ? "MASK" : "BLEND";
if (config.alphaMode === "MASK") config.alphaCutoff = 0.4;
addLog(`[透明度合并] ${config.name}: RGB=${albName || 'solid'}×${rgbScale.toFixed(3)} + A=${opcName}×${alphaScale.toFixed(3)} -> ${newName}`, "success");
} catch (e) { addLog(`[透明度合并失败] ${config.name}: ${e.message || e}`, "warn"); }
}
// v9.9.85：Static 骨色 = Diffuse 明暗 × Tekstura 象牙色（禁止 Spec→粉肤合成 / Matcap）
async function synthesizeStaticBoneAlbedo(diffuseBlob, teksturaBlob) {
let d = await loadBlobToImageData(diffuseBlob, 2048);
let t = await loadBlobToImageData(teksturaBlob, 2048);
let w = Math.max(d.w, t.w), h = Math.max(d.h, t.h);
function resize(src, sw, sh, dw, dh) {
if (sw === dw && sh === dh) return src.data;
let c = document.createElement("canvas"); c.width = dw; c.height = dh;
let ctx = c.getContext("2d", { willReadFrequently: true });
let tmp = document.createElement("canvas"); tmp.width = sw; tmp.height = sh;
tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(src.data), sw, sh), 0, 0);
ctx.drawImage(tmp, 0, 0, dw, dh);
return ctx.getImageData(0, 0, dw, dh).data;
}
let dd = resize(d, d.w, d.h, w, h);
let tt = resize(t, t.w, t.h, w, h);
let gr = 0, gg = 0, gb = 0, gn = 0;
for (let i = 0; i < tt.length; i += 4) {
let lum = 0.299 * tt[i] + 0.587 * tt[i + 1] + 0.114 * tt[i + 2];
if (lum > 210) { gr += tt[i]; gg += tt[i + 1]; gb += tt[i + 2]; gn++; }
}
if (gn < 8) { gr = 224; gg = 220; gb = 189; gn = 1; }
else { gr /= gn; gg /= gn; gb /= gn; }
let out = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < out.length; i += 4) {
let L = (0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2]) / 255;
// 略抬整体，贴近 Sketchfab 颧骨暖象牙
let gain = Math.min(1.15, 0.92 + L * 0.35);
out[i] = Math.max(0, Math.min(255, Math.round(gr * L * gain)));
out[i + 1] = Math.max(0, Math.min(255, Math.round(gg * L * gain)));
out[i + 2] = Math.max(0, Math.min(255, Math.round(gb * L * gain)));
out[i + 3] = 255;
}
let c = document.createElement("canvas"); c.width = w; c.height = h;
c.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
return await new Promise(function(resolve, reject) {
c.toBlob(function(b) { if (b) resolve(b); else reject(new Error("bone albedo blob fail")); }, "image/jpeg", 0.92);
});
}
async function fixAnatomyChartMaterial(config, texturesMap) {
if (!config || !config.name) return false;
let matBase = String(config.name).trim().split(/\s+/)[0];
if (!/^(Static|Deform|Acs|Plastyma|Melns|Skiedras)/i.test(matBase)) return false;
let keys = Object.keys(texturesMap);
config.sfMatcap = false;
delete config.sfMatcapName;
if (config.channels) config.channels.matcapUid = null;
config._skipStreakSalvage = true;
if (/^static$/i.test(matBase)) {
let texName = keys.find(function(n) { return /^Static[_\s].*tekstura/i.test(n); });
let difName = keys.find(function(n) { return /^Static[_\s].*diffuse/i.test(n); });
if (texName && difName && texturesMap[texName] && texturesMap[difName]) {
try {
let boneBlob = await synthesizeStaticBoneAlbedo(texturesMap[difName], texturesMap[texName]);
let boneName = "synth_static_bone_diffuse_x_tekstura.jpg";
texturesMap[boneName] = boneBlob;
config.mergedAlbedoName = boneName;
config._forceAlbedoName = null;
addLog(`[解剖底色] ${config.name}: Diffuse×Tekstura → ${boneName}（象牙骨，禁 Matcap）`, "success");
return true;
} catch (e) {
addLog(`[解剖底色] Static 合成失败: ${e && e.message}，回退 Tekstura`, "warn");
}
}
if (texName) {
config._forceAlbedoName = texName;
config.mergedAlbedoName = null;
addLog(`[解剖底色] ${config.name}: 回退绑定 ${texName}`, "success");
}
return true;
}
let albName = getTexNameByUid(config.channels.albedoUid);
let albLower = String(albName || '').toLowerCase();
let prefer = ['col', 'diffuse', 'tekstura'];
if (!albName || /spec|normal|ao|alpha|norm|synth/i.test(albLower)) {
let pick = null;
for (let pi = 0; pi < prefer.length; pi++) {
let pat = prefer[pi];
pick = keys.find(function(n) { return new RegExp('^' + matBase + '[_\\s].*' + pat, 'i').test(n); });
if (pick) break;
}
if (pick && pick !== albName) {
config._forceAlbedoName = pick;
config.mergedAlbedoName = null;
addLog(`[解剖底色] ${config.name}: 改绑 ${albName || '空'} → ${pick}`, "success");
}
}
return true;
}
// V9.9.25：Diffuse 斜纹时通用抢救。Colour 低频色+Spec 结构作 map；有 Matcap → extras.sfMatcap 嵌入（管理器 MeshMatcap）；无 Matcap → 软 Spec PBR 兜底
addLog(`--> 检查底色质量 (斜纹 Diffuse → Colour低频+Spec / Matcap嵌入)...`, "info");
for (let mKey in apiMatConfig) { await fixAnatomyChartMaterial(apiMatConfig[mKey], texturesMap); }
for (let mKey in apiMatConfig) {
let config = apiMatConfig[mKey];
if (!config || config.isGlass || config.mergedAlbedoName || config._skipStreakSalvage) continue;
let albName = getTexNameByUid(config.channels.albedoUid);
let specName = getTexNameByUid(config.channels.specularUid);
if (!specName) {
let keys = Object.keys(texturesMap);
specName = keys.find(function(n) { return /^spec(\.|$|_)/i.test(n) || /specular/i.test(n); }) || null;
if (specName && /sss|gloss|rough|metal|norm|ao|opacit/i.test(specName)) specName = null;
}
if (!albName || !specName) continue;
if (!texturesMap[albName] || !texturesMap[specName]) continue;
try {
let streak = await scoreAlbedoStreakiness(texturesMap[albName]);
let faceScore = await scoreFaceStructure(texturesMap[specName]);
let albFace = await scoreFaceStructure(texturesMap[albName]);
addLog(`[底色评分] ${config.name}: Diffuse streak=${streak.toFixed(2)} face=${albFace.toFixed(1)} | Spec face=${faceScore.toFixed(1)}${config.channels.matcapUid ? " | 有Matcap" : ""}`, "info");
let shouldSalvage = (faceScore >= 20 && faceScore > albFace * 2.5) ||
(streak >= 1.08 && faceScore > albFace * 1.5 && faceScore >= 18) ||
(!!config.channels.matcapUid && faceScore >= 22 && faceScore > albFace * 2);
if (!shouldSalvage) continue;
let matcapName = getTexNameByUid(config.channels.matcapUid);
let matcapBlob = (matcapName && texturesMap[matcapName]) ? texturesMap[matcapName] : null;
if (!matcapBlob) {
let mk = Object.keys(texturesMap).find(function(n) { return /matcap|skin_soft/i.test(n); });
if (mk) { matcapBlob = texturesMap[mk]; matcapName = mk; }
}
// 通用：Colour 低频 + Spec 结构；Matcap 仅微调主色，光感留给管理器 MeshMatcap
let synth = await synthesizeAlbedoFromSpecular(texturesMap[specName], texturesMap[albName], matcapBlob);
let newName = (matcapBlob ? "synth_albedo_colourLF_spec__" : "synth_albedo_soft_spec__") + String(specName).replace(/\.(jpg|jpeg|png|webp)$/i, "") + ".png";
newName = newName.replace(/[^\w.\-]+/g, "_");
texturesMap[newName] = synth;
config.mergedAlbedoName = newName;
config.alphaMode = "OPAQUE";
if (matcapBlob) {
config.sfMatcap = true;
config.sfMatcapName = matcapName;
config.channels.roughnessFactor = 1;
config.channels.metallicFactor = 0;
addLog(`[底色抢救] ${config.name}: 斜纹Diffuse → Colour低频+Spec + Matcap(${matcapName})`, "success");
} else {
if (config.channels.roughnessFactor === undefined) config.channels.roughnessFactor = 0.55;
addLog(`[底色抢救] ${config.name}: 斜纹Diffuse → Colour低频+Spec → ${newName}`, "success");
}
} catch (e) { addLog(`[底色抢救失败] ${config.name}: ${e.message || e}`, "warn"); }
}
let textureEntries = Object.entries(texturesMap);
let texMeta = []; for (let i = 0; i < textureEntries.length; i++) { let [name, blob] = textureEntries[i]; let webGLIdx = unsafeWindow.textureIdMap[name] !== undefined ? unsafeWindow.textureIdMap[name] : -1;
let arrayBuffer = await blob.arrayBuffer(); let bvIdx = addBufferView(arrayBuffer); let imgIdx = json.images.length;

// --- V9.9.2: 魔法字节校验，彻底修复文件后缀与真实内容不匹配导致的 gltf-transform 压缩崩溃问题 ---
let u8 = new Uint8Array(arrayBuffer); let mimeType = "image/png";
if (u8.length > 2 && u8[0] === 0xFF && u8[1] === 0xD8) { mimeType = "image/jpeg"; }
else if (u8.length > 3 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) { mimeType = "image/png"; }
else if (u8.length > 11 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) { mimeType = "image/webp"; if(!json.extensionsUsed) json.extensionsUsed = []; if(!json.extensionsUsed.includes("EXT_texture_webp")) json.extensionsUsed.push("EXT_texture_webp"); }
json.images.push({ bufferView: bvIdx, mimeType: mimeType, name: name }); json.textures.push({ source: imgIdx });
// -------------------------------------------------------------------------------------------------

texMeta.push({ name: name.toLowerCase(), index: i, originalName: name, webGLIdx: webGLIdx }); }
let findTexIdx = (tName) => { if(!tName) return -1; let tm = texMeta.find(t => t.originalName === tName); return tm ? tm.index : -1; };
let findTexIdxByUid = (uid) => { let tName = getTexNameByUid(uid); return findTexIdx(tName); };
json.materials.push({ name: "Untextured_BaseMat_Opaque", pbrMetallicRoughness: { baseColorFactor: [0.95, 0.95, 0.95, 1.0], metallicFactor: 0.1, roughnessFactor: 0.7 }, doubleSided: true, alphaMode: "OPAQUE" });
let untexturedMatIdx = json.materials.length - 1;
addLog(`--> API材质库已载入 ${Object.keys(apiMatConfig).length} 项，禁用名称猜测兜底。`, "info");
addLog(`--> 2/3: 正在组装 ${models.length} 个几何体组件 (索引模式+API材质)...`, "info"); let globalSpatialFingerprints = new Set();
for (let i = 0; i < models.length; i++) {
let obj = models[i].obj; let mName = (models[i].name || `model_${i}`); let originalMatName = models[i].matName;
let apiConfig = resolveApiConfig(originalMatName);
let vertexCount = (obj.vertex && obj.vertex.length > 0) ? Math.floor(obj.vertex.length / 3) : 0;
if (vertexCount < 1 || !obj.primitives || obj.primitives.length === 0) continue;
let attributes = {}; let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let j = 0; j < obj.vertex.length; j += 3) {
min[0] = Math.min(min[0], obj.vertex[j]); min[1] = Math.min(min[1], obj.vertex[j + 1]); min[2] = Math.min(min[2], obj.vertex[j + 2]);
max[0] = Math.max(max[0], obj.vertex[j]); max[1] = Math.max(max[1], obj.vertex[j + 1]); max[2] = Math.max(max[2], obj.vertex[j + 2]);
}
let f32pos = new Float32Array(obj.vertex); let bvIdx = addBufferView(f32pos, 34962);
attributes.POSITION = addAccessor(bvIdx, 5126, vertexCount, "VEC3", min, max);
if (obj.normal && obj.normal.length >= vertexCount * 3) {
let f32n = new Float32Array(obj.normal); let bvN = addBufferView(f32n, 34962);
attributes.NORMAL = addAccessor(bvN, 5126, vertexCount, "VEC3");
}
let uvChannel = (apiConfig && apiConfig.channels.albedoTexCoord !== undefined) ? apiConfig.channels.albedoTexCoord : 0;
let uvRaw = getUVSet(obj.uvSets, uvChannel);
let hasUV = false; let uvMeta = null;
if (uvRaw && uvRaw.length >= 4) {
let uvArr = uvRaw instanceof Float32Array ? uvRaw : new Float32Array(uvRaw);
let albedoBlobForUv = null;
if (apiConfig) {
let albNameForUv = apiConfig.mergedAlbedoName ? apiConfig.mergedAlbedoName : getTexNameByUid(apiConfig.channels.albedoUid);
if (albNameForUv && texturesMap[albNameForUv]) albedoBlobForUv = texturesMap[albNameForUv];
}
let flipDecision = await chooseFlipVForAlbedo(uvArr, albedoBlobForUv);
uvMeta = buildNormalizedUV(uvArr, flipDecision.flipV);
let uvVertCount = Math.floor(uvMeta.f32.length / 2);
addLog(`[UV] ${originalMatName||mName}: ch=${uvChannel} divisor=${uvMeta.divisor} flipV=${uvMeta.flipV} (${flipDecision.reason} flip=${flipDecision.scoreFlip.toFixed(1)} no=${flipDecision.scoreNo.toFixed(1)} ratio=${(flipDecision.ratio||0).toFixed(2)}) pos=${vertexCount} uv=${uvVertCount}`, uvVertCount === vertexCount ? "info" : "warn");
if (uvVertCount === vertexCount) {
let bvU = addBufferView(uvMeta.f32, 34962); attributes.TEXCOORD_0 = addAccessor(bvU, 5126, vertexCount, "VEC2"); hasUV = true;
}
}
// 通用：近隐眼球无 UV → 由顶点位置生成球面 UV，供程序化虹膜贴图
if (!hasUV && apiConfig && apiConfig.sfEyeball) {
let sph = buildSphericalUVsFromPositions(f32pos, (obj.normal && obj.normal.length >= vertexCount * 3) ? new Float32Array(obj.normal) : null);
if (sph && sph.length === vertexCount * 2) {
let bvU = addBufferView(sph, 34962); attributes.TEXCOORD_0 = addAccessor(bvU, 5126, vertexCount, "VEC2"); hasUV = true;
apiConfig._sfEyeballSphericalUV = true;
addLog(`[UV] ${originalMatName||mName}: 无UV眼球 → 球面UV(${vertexCount})`, "success");
}
}
let assignedMat = untexturedMatIdx;
let matAlphaMode = apiConfig ? apiConfig.alphaMode : "OPAQUE"; let r = 1, g = 1, b = 1, a = 1;
if (apiConfig && !apiConfig.isGlass) {
// 透明度已烘焙进 merged 贴图时 factor 用 1；否则保留 API Opacity.factor
if (apiConfig.mergedAlbedoName) a = 1;
else if (apiConfig.channels.opacityFactor !== undefined) a = apiConfig.channels.opacityFactor;
}
let roughDefault = (apiConfig && apiConfig.channels.roughnessFactor !== undefined) ? apiConfig.channels.roughnessFactor : 0.6;
let metalDefault = (apiConfig && apiConfig.channels.metallicFactor !== undefined) ? apiConfig.channels.metallicFactor : 0.05;
// 通用玻璃层：透射 + 清漆高光（仅 additive / alphaBlend+IOR；近隐无贴图层保持 BLEND，避免预览变白底实心）
if (apiConfig && apiConfig.isGlass) {
r = 1; g = 1; b = 1; a = 1;
if (apiConfig.channels.albedoColor && !apiConfig.channels.albedoUid) {
r = apiConfig.channels.albedoColor[0];
g = apiConfig.channels.albedoColor[1];
b = apiConfig.channels.albedoColor[2];
}
metalDefault = 0;
// 玻璃壳用 Opacity.roughnessFactor（角膜常为 0），不要用眼球 Roughness 贴图因子把壳磨成哑光
if (apiConfig.channels.opacityRoughness !== null && apiConfig.channels.opacityRoughness !== undefined) {
roughDefault = Math.max(0.0, Number(apiConfig.channels.opacityRoughness));
} else {
roughDefault = 0.05;
}
matAlphaMode = "OPAQUE";
}
let newMat = { name: originalMatName || mName, pbrMetallicRoughness: { baseColorFactor: [r, g, b, a], metallicFactor: metalDefault, roughnessFactor: roughDefault }, doubleSided: true, alphaMode: matAlphaMode };
if (apiConfig && apiConfig.alphaCutoff !== undefined) newMat.alphaCutoff = apiConfig.alphaCutoff;
if (apiConfig && apiConfig.sfEyeball) {
// 通用：近隐无贴图层 → 湿润眼球 + 程序化虹膜（球面 UV）。禁止 skin_* / gray Matcap 当底色。
newMat.alphaMode = "OPAQUE";
newMat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
newMat.pbrMetallicRoughness.metallicFactor = 0;
newMat.pbrMetallicRoughness.roughnessFactor = 0.18;
if (!apiConfig.sfEyeballIrisName) {
try {
let irisBlob = await synthesizeEyeballAlbedo([0.22, 0.28, 0.34]);
let irisName = "synth_eyeball_iris.jpg";
texturesMap[irisName] = irisBlob;
// 立即入库，便于 findTexIdx
let irisU8 = new Uint8Array(await irisBlob.arrayBuffer());
let irisBv = addBufferView(irisU8);
let irisImgIdx = json.images.length;
json.images.push({ bufferView: irisBv, mimeType: "image/jpeg", name: irisName });
json.textures.push({ source: irisImgIdx });
texMeta.push({ name: irisName.toLowerCase(), index: json.textures.length - 1, originalName: irisName, webGLIdx: -1 });
apiConfig.sfEyeballIrisName = irisName;
addLog(`[眼球层] ${originalMatName||mName}: 程序化虹膜贴图 ${irisName}`, "success");
} catch (eIris) {
addLog(`[眼球层] 虹膜合成失败: ${eIris && eIris.message}`, "warn");
}
}
if (apiConfig.sfEyeballIrisName) {
let irisIdx = findTexIdx(apiConfig.sfEyeballIrisName);
if (irisIdx !== -1) {
newMat.pbrMetallicRoughness.baseColorTexture = { index: irisIdx };
}
}
newMat.extras = Object.assign({}, newMat.extras || {}, { sfEyeball: true, sfEyeballIris: !!apiConfig.sfEyeballIrisName });
addLog(`[材质绑定] ${originalMatName||mName}: extras.sfEyeball 程序化虹膜${apiConfig._sfEyeballSphericalUV ? "+球面UV" : ""}`, "success");
}
if (apiConfig && apiConfig.unlit) {
if (!json.extensionsUsed) json.extensionsUsed = [];
if (!json.extensionsUsed.includes("KHR_materials_unlit")) json.extensionsUsed.push("KHR_materials_unlit");
newMat.extensions = Object.assign({}, newMat.extensions, { KHR_materials_unlit: {} });
newMat.pbrMetallicRoughness.metallicFactor = 0;
newMat.pbrMetallicRoughness.roughnessFactor = 1;
addLog(`[材质绑定] ${originalMatName||mName}: KHR_materials_unlit（Matcap抢救底色，禁止管理器二次打光）`, "success");
}
if (apiConfig && apiConfig.isGlass) {
if (!json.extensionsUsed) json.extensionsUsed = [];
if (!json.extensionsUsed.includes("KHR_materials_transmission")) json.extensionsUsed.push("KHR_materials_transmission");
if (!json.extensionsUsed.includes("KHR_materials_clearcoat")) json.extensionsUsed.push("KHR_materials_clearcoat");
let ior = (apiConfig.channels.opacityIor !== undefined && apiConfig.channels.opacityIor !== null) ? Number(apiConfig.channels.opacityIor) : 1.4;
if (ior > 1.01) {
if (!json.extensionsUsed.includes("KHR_materials_ior")) json.extensionsUsed.push("KHR_materials_ior");
}
newMat.extensions = {
KHR_materials_transmission: {
transmissionFactor: (apiConfig.channels.transmissionFactor !== undefined) ? Number(apiConfig.channels.transmissionFactor) : 1
},
KHR_materials_clearcoat: {
clearcoatFactor: (apiConfig.channels.clearcoatFactor !== undefined) ? Number(apiConfig.channels.clearcoatFactor) : 1,
clearcoatRoughnessFactor: (apiConfig.channels.clearcoatRoughness !== undefined) ? Number(apiConfig.channels.clearcoatRoughness) : 0.04
}
};
if (ior > 1.01) newMat.extensions.KHR_materials_ior = { ior: ior };
addLog(`[材质绑定] ${originalMatName||mName}: 玻璃 transmission=${newMat.extensions.KHR_materials_transmission.transmissionFactor} clearcoat=${newMat.extensions.KHR_materials_clearcoat.clearcoatFactor} ior=${ior} rough=${roughDefault}`, "success");
}
let texFound = false;
if (hasUV && apiConfig) {
if (apiConfig.isGlass) {
texFound = true;
// 仅当透明贴图有空间变化时才挂 transmissionTexture；纯白/纯灰图会误伤观感
let tUid = apiConfig.channels.transmissionUid;
let tName = getTexNameByUid(tUid);
let tMeta = tName && unsafeWindow._sf_texMeta ? unsafeWindow._sf_texMeta[tName] : null;
let useTxTex = tMeta && tMeta.variance !== undefined && tMeta.variance > 80;
if (useTxTex) {
let tIdx = findTexIdxByUid(tUid);
if (tIdx !== -1) {
newMat.extensions.KHR_materials_transmission.transmissionTexture = { index: tIdx };
addLog(`[材质绑定] ${originalMatName||mName} transmissionTexture -> ${tName}`, "api");
}
} else if (tName) {
addLog(`[材质绑定] ${originalMatName||mName}: 跳过平坦透明贴图(${tName})作 transmissionTexture`, "info");
}
let normIdx = findTexIdxByUid(apiConfig.channels.normalUid);
if (normIdx !== -1) { newMat.normalTexture = { index: normIdx }; if (apiConfig.channels.normalFactor !== undefined) newMat.normalTexture.scale = apiConfig.channels.normalFactor; }
} else {
let albedoName = apiConfig.mergedAlbedoName ? apiConfig.mergedAlbedoName : (apiConfig._forceAlbedoName || getTexNameByUid(apiConfig.channels.albedoUid));
if (albedoName && !apiConfig.mergedAlbedoName && !apiConfig._forceAlbedoName && !isAlbedoLikeName(albedoName)) {
addLog(`[材质绑定] ${originalMatName||mName}: 底色槽为非颜色贴图(${albedoName})，保留灰阶+透明度合并结果，不回退 Base_Color`, "warn");
}
let albIdx = findTexIdx(albedoName); if (albIdx === -1 && albedoName) albIdx = findTexIdxByUid(apiConfig.channels.albedoUid);
if (albIdx !== -1 && albedoName) { newMat.pbrMetallicRoughness.baseColorTexture = { index: albIdx }; texFound = true; addLog(`[材质绑定] ${originalMatName||mName} -> ${albedoName}`, "api"); }
if (apiConfig.sfMatcap) {
let mcIdx = findTexIdx(apiConfig.sfMatcapName);
if (mcIdx === -1) {
let mk = texMeta.find(function(t) { return /matcap|skin_soft/i.test(t.originalName || ""); });
if (mk) mcIdx = mk.index;
}
if (mcIdx !== -1) {
newMat.emissiveFactor = [0, 0, 0];
newMat.emissiveTexture = { index: mcIdx };
newMat.extras = Object.assign({}, newMat.extras || {}, { sfMatcap: true, sfMatcapTexName: apiConfig.sfMatcapName || "matcap" });
addLog(`[材质绑定] ${originalMatName||mName}: 嵌入 Matcap → emissiveTexture + extras.sfMatcap（管理器 MeshMatcap 直出）`, "success");
}
}
if (apiConfig.sfEyeball && apiConfig.sfEyeballIrisName) {
let irisIdx2 = findTexIdx(apiConfig.sfEyeballIrisName);
if (irisIdx2 !== -1) {
newMat.pbrMetallicRoughness.baseColorTexture = { index: irisIdx2 };
newMat.extras = Object.assign({}, newMat.extras || {}, { sfEyeball: true, sfEyeballIris: true });
}
}
if (!apiConfig.unlit) {
let normIdx = findTexIdxByUid(apiConfig.channels.normalUid);
if (normIdx !== -1) { newMat.normalTexture = { index: normIdx }; if (apiConfig.channels.normalFactor !== undefined) newMat.normalTexture.scale = apiConfig.channels.normalFactor; }
if (!apiConfig.sfMatcap) {
let aoIdx = findTexIdxByUid(apiConfig.channels.aoUid);
if (aoIdx !== -1) { newMat.occlusionTexture = { index: aoIdx }; if (apiConfig.channels.aoFactor !== undefined) newMat.occlusionTexture.strength = apiConfig.channels.aoFactor; }
let mrIdx = findTexIdx(apiConfig.packedMRName);
if (mrIdx !== -1) {
newMat.pbrMetallicRoughness.metallicRoughnessTexture = { index: mrIdx };
addLog(`[材质绑定] ${originalMatName||mName} metallicRoughness -> ${apiConfig.packedMRName}`, "api");
}
}
}
}
}
if (!texFound && apiConfig && apiConfig.channels.albedoColor && !apiConfig.isGlass && !apiConfig.sfEyeball) {
newMat.pbrMetallicRoughness.baseColorFactor[0] = apiConfig.channels.albedoColor[0];
newMat.pbrMetallicRoughness.baseColorFactor[1] = apiConfig.channels.albedoColor[1];
newMat.pbrMetallicRoughness.baseColorFactor[2] = apiConfig.channels.albedoColor[2];
}
json.materials.push(newMat); assignedMat = json.materials.length - 1;
let useVertexColor = false;
if (!texFound && obj.color && obj.color.length > 0) {
let isAllZero = true; for(let k=0; k<obj.color.length; k++) { if(obj.color[k] > 0.05) { isAllZero = false; break; } }
if (!isAllZero) useVertexColor = true;
}
if (useVertexColor) {
let cComps = obj.color.length / vertexCount;
if (cComps >= 3 && Number.isInteger(cComps)) {
let isUint = false; let maxColor = 0; for(let k=0; k<obj.color.length; k++) { if(obj.color[k] > maxColor) maxColor = obj.color[k]; }
if (maxColor > 2.0) isUint = true; let isVec4 = (cComps >= 4);
let f32c = new Float32Array(vertexCount * (isVec4 ? 4 : 3));
for(let v=0; v<vertexCount; v++) {
let cr = isUint ? obj.color[v*cComps+0]/255.0 : obj.color[v*cComps+0];
let cg = isUint ? obj.color[v*cComps+1]/255.0 : obj.color[v*cComps+1];
let cb = isUint ? obj.color[v*cComps+2]/255.0 : obj.color[v*cComps+2];
f32c[v*(isVec4?4:3)+0] = Math.max(0, Math.min(1, cr));
f32c[v*(isVec4?4:3)+1] = Math.max(0, Math.min(1, cg));
f32c[v*(isVec4?4:3)+2] = Math.max(0, Math.min(1, cb));
if (isVec4) f32c[v*4+3] = Math.max(0, Math.min(1, isUint ? obj.color[v*cComps+3]/255.0 : obj.color[v*cComps+3]));
}
let bvC = addBufferView(f32c, 34962); attributes.COLOR_0 = addAccessor(bvC, 5126, vertexCount, isVec4 ? "VEC4" : "VEC3");
}
}
let validPrimitives = [];
for (let p = 0; p < obj.primitives.length; p++) {
let prim = obj.primitives[p];
if (!prim.indices || !prim.indices.length) continue;
let iCount = prim.indices.length;
let spatialFingerprint = `${vertexCount}_${iCount}_${originalMatName||mName}_${min[0].toFixed(4)}_${min[1].toFixed(4)}_${min[2].toFixed(4)}_${p}`;
if (globalSpatialFingerprints.has(spatialFingerprint)) continue;
globalSpatialFingerprints.add(spatialFingerprint);
let finalIndices = triangulateIndices(prim.indices, prim.mode);
if (finalIndices.length < 3) continue;
let is32Bit = vertexCount > 65535; let TypedArr = is32Bit ? Uint32Array : Uint16Array; let compType = is32Bit ? 5125 : 5123;
let indicesArr = new TypedArr(finalIndices); let bvI = addBufferView(indicesArr, 34963);
let indicesAcc = addAccessor(bvI, compType, finalIndices.length, "SCALAR");
validPrimitives.push({ attributes: attributes, mode: 4, indices: indicesAcc, material: assignedMat });
}
if (validPrimitives.length > 0) {
let meshIdx = json.meshes.length; json.meshes.push({ name: mName, primitives: validPrimitives });
let nodeIdx = json.nodes.length; json.nodes.push({ mesh: meshIdx });
if (fixZUp) { json.nodes[rootNodeIdx].children.push(nodeIdx); } else { json.scenes[0].nodes.push(nodeIdx); }
}
}
addLog("--> 3/3: 二进制对齐完成，正在生成终极版 GLB...", "info"); json.buffers[0].byteLength = currentOffset;
let jsonBytes = new TextEncoder().encode(JSON.stringify(json)); let jsonPadding = (4 - (jsonBytes.length % 4)) % 4; let paddedJsonBytes = new Uint8Array(jsonBytes.length + jsonPadding); paddedJsonBytes.set(jsonBytes);
for(let i=0; i<jsonPadding; i++) paddedJsonBytes[jsonBytes.length + i] = 0x20; let jsonChunkLength = paddedJsonBytes.length; let binChunkLength = currentOffset; let totalLength = 12 + (8 + jsonChunkLength) + (8 + binChunkLength);
let finalBuffer = new ArrayBuffer(totalLength); let dataView = new DataView(finalBuffer); let uint8View = new Uint8Array(finalBuffer); dataView.setUint32(0, 0x46546C67, true);
dataView.setUint32(4, 2, true); dataView.setUint32(8, totalLength, true); dataView.setUint32(12, jsonChunkLength, true); dataView.setUint32(16, 0x4E4F534A, true);
uint8View.set(paddedJsonBytes, 20); let binChunkStart = 20 + jsonChunkLength; dataView.setUint32(binChunkStart, binChunkLength, true); dataView.setUint32(binChunkStart + 4, 0x004E4942, true);
let binOffset = binChunkStart + 8; for (let i = 0; i < binBuffers.length; i++) { uint8View.set(binBuffers[i], binOffset); binOffset += binBuffers[i].length; }
return new Blob([finalBuffer], { type: "model/gltf-binary" }); }
// ================= 模型骨架截获核心 =================
(function() { 'use strict'; var button_dw = false; unsafeWindow.activateMeshButton = function() { var btn = document.getElementById("sf-btn-mesh"); if(btn && !button_dw) {
btn.innerText = "🚀 一键生成像素级复刻 GLB (v9.9.2 压缩防崩版)"; btn.style.background = "#d9534f"; btn.style.color = "#fff"; btn.disabled = false;
btn.addEventListener("click", dodownload , false); button_dw = true; unsafeWindow._sf_flags.meshReady = true; addLog("模型骨架及材质树截获完毕！请先提取贴图。", "success"); tryAutoExport("mesh_ready"); } }
var dodownload = async function() { var isZUpFixed = document.getElementById("sf-chk-zup") ? document.getElementById("sf-chk-zup").checked : false;
addLog(`▶ 触发智能计分通用装配流程... (坐标修正: ${isZUpFixed?'开启':'关闭'})`, "info"); var btn = document.getElementById("sf-btn-mesh"); if(btn) btn.innerText = "⏳ 正在压制最终封包..."; try {
var parsedModels = []; var idx = 0; unsafeWindow.allmodel.forEach(function(obj) {
let meshName = (obj._name && isNaN(obj._name) && !obj._name.includes("RootNode") && !obj._name.includes("RootMatrix")) ? obj._name : null;
let matName = (obj.stateset && obj.stateset._name && isNaN(obj.stateset._name)) ? obj.stateset._name : null; if (!meshName || !matName) { let curr = obj; let depth = 0; while(curr && depth < 3) {
if (!meshName && curr._name && isNaN(curr._name) && !curr._name.includes("RootNode") && !curr._name.includes("RootMatrix")) { meshName = curr._name; }
if (!matName && curr.stateset && curr.stateset._name && isNaN(curr.stateset._name)) { matName = curr.stateset._name; }
if (meshName && matName) break; curr = (curr._parents && curr._parents.length > 0) ? curr._parents[0] : null; depth++; } }
let finalName = meshName || ("model_"+idx); let finalMatName = matName || "UnknownMaterial"; parsedModels.push({ name: finalName, matName: finalMatName, obj: parseobj(obj), rawOsgObj: obj }); idx++; });
var glbBlob = await buildGLB(parsedModels, (function(){
let clean = {};
for (let k in unsafeWindow.objects) {
if (k.indexOf("tex_catch_") === 0) continue;
let meta = unsafeWindow._sf_texMeta ? unsafeWindow._sf_texMeta[k] : null;
if (meta && !meta.valid) continue;
clean[k] = unsafeWindow.objects[k];
}
return clean;
})(), isZUpFixed); var file_name = document.getElementsByClassName('model-name__label')[0]; file_name = file_name ? file_name.textContent.trim() : "sketchfab_extracted";
saveFile(glbBlob, file_name + "_V9.9.83_Ultimate.glb"); addLog(`🎉 大功告成！探针复刻版已保存：${file_name}_V9.9.83_Ultimate.glb`, "success"); if(btn) { btn.innerText = "🚀 重新下载 GLB"; btn.style.background = "#5cb85c"; } } catch (err) { addLog("导出崩溃: " + err.message, "error"); console.error(err); } }
unsafeWindow._sf_doDownload = dodownload;
var parseobj = function(obj) { var list = []; if(obj._primitives) { obj._primitives.forEach(function(p) { if(p && p.indices) { list.push({ 'mode' : p.mode, 'indices' : p.indices._elements }); } }); }
var attr = obj._attributes || {}; var uvSetsMap = {}; var uvItemSize = 2;
for (let ti = 0; ti <= 8; ti++) {
let key = 'TexCoord' + ti;
if (attr[key]) {
let uvPack = extractUVFromAttr(attr[key]);
if (uvPack && uvPack.f32 && uvPack.f32.length) { uvSetsMap[ti] = uvPack.f32; if (ti === 0 || !uvSetsMap[0]) uvItemSize = uvPack.itemSize; }
}
}
if (!Object.keys(uvSetsMap).length) {
for (var k in attr) { let lowerK = k.toLowerCase();
if (lowerK.includes('tangent') || lowerK.includes('bitangent')) continue;
if ((lowerK.includes('texcoord') || (lowerK.includes('uv') && !lowerK.includes('curve'))) && attr[k] && attr[k]._elements && attr[k]._elements.length) {
let match = k.match(/(\d+)/); let uvIdx = match ? parseInt(match[0], 10) : 0;
if (!uvSetsMap[uvIdx]) {
let uvPack = extractUVFromAttr(attr[k]);
if (uvPack && uvPack.f32 && uvPack.f32.length) { uvSetsMap[uvIdx] = uvPack.f32; uvItemSize = uvPack.itemSize; }
}
}
}
}
var cleanUvs = [];
for (let ui = 0; ui <= 8; ui++) { if (uvSetsMap[ui]) cleanUvs[ui] = uvSetsMap[ui]; }
var colE = []; var possibleCols = ['Color', 'Color_0', 'Color0', 'a_Color']; for (var j=0; j<possibleCols.length; j++) { if (attr[possibleCols[j]] && attr[possibleCols[j]]._elements && attr[possibleCols[j]]._elements.length) { colE = attr[possibleCols[j]]._elements; break; } }
return { vertex: attr.Vertex ? attr.Vertex._elements : [], normal: attr.Normal ? attr.Normal._elements : [], uvSets: cleanUvs, uvItemSize: uvItemSize, color: colE, primitives: list, exactTextureIds: Array.from(obj._sf_textures || []), _attributes: attr }; }
unsafeWindow.attachbody = function(obj) { if (!obj._sf_textures) obj._sf_textures = new Set(); if (unsafeWindow._sf_globalBoundTextures) { for(let u=0; u<unsafeWindow._sf_globalBoundTextures.length; u++) {
let tId = unsafeWindow._sf_globalBoundTextures[u]; if (tId !== -1 && tId !== undefined) obj._sf_textures.add(tId); } }
if(obj._faked != true && ((obj.stateset && obj.stateset._name) || obj._name || (obj._parents && obj._parents[0]._name)) ) {
obj._faked = true; if(obj._name == "composer layer" || obj._name == "Ground - Geometry") return; unsafeWindow.allmodel.push(obj);
// 不要只依赖 activateMeshButton：有模型节点就当作 meshReady，并在贴图就绪后触发自动导出
try { if(unsafeWindow._sf_flags) unsafeWindow._sf_flags.meshReady = true; } catch(_e) {}
tryAutoExport("mesh_attachbody_first"); } } })(); // ================= 代码拦截器 =================
(() => { "use strict"; const Event = class { constructor(script, target) { this.script = script; this.target = target; this._cancel = false; this._replace = null; this._stop = false; }
preventDefault() { this._cancel = true; } stopPropagation() { this._stop = true; } replacePayload(payload) { this._replace = payload; } }; let callbacks = []; unsafeWindow.addBeforeScriptExecuteListener = (f) => { callbacks.push(f); }; const dispatch = (script, target) => {
if (script.tagName !== "SCRIPT") return; const e = new Event(script, target); if (typeof unsafeWindow.onbeforescriptexecute === "function") { try { unsafeWindow.onbeforescriptexecute(e); } catch (err) {} }
for (const func of callbacks) { if (e._stop) break; try { func(e); } catch (err) {} }
if (e._cancel) { script.textContent = ""; script.remove(); } else if (typeof e._replace === "string") { script.textContent = e._replace; } };
if (!unsafeWindow._sf_observer_injected) { unsafeWindow._sf_observer_injected = true; const observer = new MutationObserver((mutations) => { for (const m of mutations) { for (const n of m.addedNodes) dispatch(n, m.target); } }); observer.observe(document, { childList: true, subtree: true }); } })(); (() => { "use strict";
var func_drawGeometry = /(this\._stateCache\.drawGeometry\(this\._graphicContext,\s*([a-zA-Z0-9_]+)\))/g;
var func_drawGeometryCall = /\.drawGeometry\(\s*([^,]+)\s*,\s*([a-zA-Z0-9_$]+)\s*\)/g;
var func_drawGeometryFn = /drawGeometry\s*=\s*function\s*\(([^)]*)\)\s*\{/g;
var func_protoDrawGeometryFn = /\.drawGeometry\s*=\s*function\s*\(([^)]*)\)\s*\{/g;
var func_drawGeometryWrapper = /drawGeometry\s*:\s*function\s*\(\s*([a-zA-Z0-9_$]+)\s*\)\s*\{\s*this\._stateCache\.drawGeometry\(this\._graphicContext,\s*\1\s*\)/g;
function patchViewerScript(jstext) {
if (!jstext || jstext.indexOf("drawGeometry") < 0) return { ok: false, jstext: jstext, mode: "none" };
if (func_drawGeometryWrapper.test(jstext)) {
func_drawGeometryWrapper.lastIndex = 0;
jstext = jstext.replace(func_drawGeometryWrapper, "drawGeometry:function($1){try{window.attachbody&&window.attachbody($1);}catch(e){}this._stateCache.drawGeometry(this._graphicContext,$1)");
return { ok: true, jstext: jstext, mode: "drawGeometryWrapper" };
}
let ret = func_drawGeometry.exec(jstext);
if (ret) {
jstext = jstext.replace(func_drawGeometry, "(window.attachbody&&window.attachbody($2),$1)");
return { ok: true, jstext: jstext, mode: "stateCache" };
}
func_drawGeometryCall.lastIndex = 0;
if (func_drawGeometryCall.test(jstext)) {
func_drawGeometryCall.lastIndex = 0;
jstext = jstext.replace(func_drawGeometryCall, "(window.attachbody&&window.attachbody($2),this.drawGeometry($1,$2))");
return { ok: true, jstext: jstext, mode: "drawGeometryCall" };
}
if (func_drawGeometryFn.test(jstext)) {
func_drawGeometryFn.lastIndex = 0;
jstext = jstext.replace(func_drawGeometryFn, "drawGeometry=function($1){try{var __sf_g=arguments[1];if(__sf_g&&window.attachbody)window.attachbody(__sf_g);}catch(e){}");
return { ok: true, jstext: jstext, mode: "drawGeometryFn" };
}
if (func_protoDrawGeometryFn.test(jstext)) {
func_protoDrawGeometryFn.lastIndex = 0;
jstext = jstext.replace(func_protoDrawGeometryFn, ".drawGeometry=function($1){try{var __sf_g=arguments[1];if(__sf_g&&window.attachbody)window.attachbody(__sf_g);}catch(e){}");
return { ok: true, jstext: jstext, mode: "protoDrawGeometryFn" };
}
return { ok: false, jstext: jstext, mode: "none" };
}
unsafeWindow.onbeforescriptexecute = (e) => { var srimgc = e.script || e.target;
if(!(srimgc instanceof HTMLScriptElement)) return;
if (unsafeWindow._sf_viewer_patched) return;
if (srimgc.src.indexOf("web/dist/") >= 0 || srimgc.src.indexOf("standaloneViewer") >= 0) { e.preventDefault(); e.stopPropagation(); try {
// 同一页可能拦到多个 dist 脚本；成功/失败提示各只打一次，避免日志刷屏
if (!unsafeWindow._sf_viewer_patch_log_start) {
unsafeWindow._sf_viewer_patch_log_start = true;
addLog("检测到 Sketchfab 主脚本，开始注入几何体拦截器...", "info");
}
var req = new XMLHttpRequest(); req.open('GET', srimgc.src, false); req.send(''); var jstext = req.responseText; var patch = patchViewerScript(jstext);
if (patch.ok) {
jstext = patch.jstext; unsafeWindow._sf_viewer_patched = true; addLog(`主脚本补丁注入成功(${patch.mode})，等待模型加载...`, "success"); setTimeout(unsafeWindow.activateMeshButton, 3000); }
else if (!unsafeWindow._sf_viewer_patch_log_miss) {
unsafeWindow._sf_viewer_patch_log_miss = true;
addLog("已拦到主脚本，但当前版本的特征码没匹配上，可能是 Sketchfab 更新了。", "warn");
}
var obj = document.createElement('script'); obj.type = "text/javascript"; obj.text = jstext; document.getElementsByTagName('head')[0].appendChild(obj); } catch(err) { addLog("拦截错误: " + err.message, "error"); } } }; })(); // ================= 高清材质无缝自动化提取核心 =================
(function () { let model_name = location.pathname.split("/")[2]; let model_name_arr = model_name ? model_name.split("-") : []; let model_id = model_name_arr[model_name_arr.length - 1]; let originTextureArr = []; let isEmbed = location.pathname.includes('/embed');
if(!isEmbed){ setTimeout(()=>{ var btnTex = document.getElementById("sf-btn-tex"); if(btnTex) { btnTex.innerText = "➡️ 跳转纯净模式以提取彩色贴图"; btnTex.style.background = "#8e44ad"; btnTex.style.color = "#fff"; btnTex.disabled = false; btnTex.onclick = ()=>{ let link = document.createElement("a"); link.setAttribute("href",`https://sketchfab.com/models/${model_id}/embed?autostart=1&internal=1&tracking=0&ui_ar=0&ui_infos=0&ui_snapshots=1&ui_stop=0&ui_theatre=1&ui_watermark=0`); link.setAttribute("target","_blank"); document.body.appendChild(link); link.click(); document.body.removeChild(link); }; } }, 3000); return; }
let autoDumpTimer = null;
unsafeWindow._sf_texMeta = unsafeWindow._sf_texMeta || {};
function getTextureCatalog() {
let pref = unsafeWindow.prefetchedData || {};
let keys = Object.keys(pref).filter(k => k.includes(`/i/models/${model_id}/textures`));
let merged = {};
for (let ki = 0; ki < keys.length; ki++) {
let results = pref[keys[ki]].results || [];
for (let i = 0; i < results.length; i++) {
let t = results[i]; if (!t || !t.uid) continue;
if (!merged[t.uid]) merged[t.uid] = { uid: t.uid, name: t.name, url: t.url, images: [] };
if (t.name) merged[t.uid].name = t.name;
if (t.url) merged[t.uid].url = t.url;
if (t.images && t.images.length) merged[t.uid].images = merged[t.uid].images.concat(t.images);
}
}
return Object.values(merged);
}
async function fetchMatcapsIntoCatalog() {
// 通用：Matcap 不在 /textures 里，在 /matcaps；不拉则 UID 对不上、Matcap 优先装配失效
try {
let urls = [
`https://sketchfab.com/i/models/${model_id}/matcaps?optimized=1`,
`https://sketchfab.com/i/models/${model_id}/matcaps`
];
let merged = {};
for (let ui = 0; ui < urls.length; ui++) {
try {
let res = await fetch(urls[ui], { credentials: "include" });
if (!res.ok) continue;
let j = await res.json();
let arr = j.results || [];
for (let i = 0; i < arr.length; i++) {
let t = arr[i]; if (!t || !t.uid) continue;
if (!merged[t.uid]) merged[t.uid] = { uid: t.uid, name: t.name || ("matcap_" + t.uid + ".png"), url: t.url, images: [], _isMatcap: true };
if (t.name) merged[t.uid].name = t.name;
if (t.images && t.images.length) merged[t.uid].images = merged[t.uid].images.concat(t.images);
}
} catch (e) {}
}
let list = Object.values(merged);
if (!list.length) { addLog("Matcap 接口无结果（本模型可能未使用 Matcap）", "info"); return 0; }
for (let i = 0; i < list.length; i++) {
let tex = list[i];
let existed = originTextureArr.find(function(t) { return t.uid === tex.uid; });
if (existed) {
existed.images = (existed.images || []).concat(tex.images || []);
existed._isMatcap = true;
if (tex.name) existed.name = tex.name;
} else {
originTextureArr.push(tex);
}
}
coverTexture(list);
addLog(`Matcap 目录已合并：${list.length} 张（/matcaps 接口）`, "success");
return list.length;
} catch (e) {
addLog("Matcap 目录拉取失败: " + (e.message || e), "warn");
return 0;
}
}
function imageUrlScore(url) {
if (!url) return 0;
let u = String(url).toLowerCase();
let score = 0;
if (u.includes("thumb") || u.includes("preview") || u.includes("lowres") || u.includes("placeholder")) score -= 1000000;
let m = u.match(/(\d{3,5})x(\d{3,5})/);
if (m) score += Number(m[1]) * Number(m[2]);
return score;
}
function isRasterImageUrl(url) {
if (!url) return false;
let u = String(url).toLowerCase();
if (u.includes(".ktx") || u.includes("basis") || u.includes("astc") || u.includes(".dds")) return false;
return /\.(jpe?g|png|webp)(\?|$|#)/.test(u);
}
function pickBestImage(images) { if (!Array.isArray(images) || images.length === 0) return null;
let raster = [];
for (let i = 0; i < images.length; i++) { if (images[i] && images[i].url && isRasterImageUrl(images[i].url)) raster.push(images[i]); }
let pool = raster.length ? raster : images;
let best = null; let bestScore = -1;
let seen = {};
for (let i = 0; i < pool.length; i++) {
let item = pool[i]; if (!item || !item.url || seen[item.url]) continue;
seen[item.url] = true;
let w = Number(item.width || 0); let h = Number(item.height || 0);
let score = w * h;
if (score <= 0) score = imageUrlScore(item.url);
if (Number(item.size || 0) > 0) score += Number(item.size);
if (/\.png(\?|$|#)/i.test(item.url)) score += 500000;
// 优先 Sketchfab 已处理档（带 format），避开无 format 的超大原档（部分模型原档 UV 填充异常）
if (item.options && item.options.format) score += 50000000;
if (score > bestScore) { bestScore = score; best = item; }
}
return best || pool[pool.length - 1];
}
async function analyzeTextureQuality(blob) {
return new Promise((resolve) => {
try {
let img = new Image();
img.onload = () => {
try {
let canvas = document.createElement("canvas");
canvas.width = 64; canvas.height = 64;
let ctx = canvas.getContext("2d", { willReadFrequently: true });
ctx.drawImage(img, 0, 0, 64, 64);
let d = ctx.getImageData(0, 0, 64, 64).data;
let sum = 0, sum2 = 0, n = 0;
for (let i = 0; i < d.length; i += 4) {
let y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
sum += y; sum2 += y * y; n++;
}
let mean = sum / n;
let variance = sum2 / n - mean * mean;
URL.revokeObjectURL(img.src);
resolve({ variance: variance, mean: mean });
} catch (e) { URL.revokeObjectURL(img.src); resolve({ variance: 0, mean: 0 }); }
};
img.onerror = () => { URL.revokeObjectURL(img.src); resolve({ variance: 0, mean: 0 }); };
img.src = URL.createObjectURL(blob);
} catch (e) { resolve({ variance: 0, mean: 0 }); }
});
}
function getTextureMeta(name) { return (unsafeWindow._sf_texMeta && unsafeWindow._sf_texMeta[name]) ? unsafeWindow._sf_texMeta[name] : null; }
async function isRasterImageBlob(blob) {
try {
let u8 = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
if (u8.length > 2 && u8[0] === 0xFF && u8[1] === 0xD8) return true;
if (u8.length > 3 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return true;
if (u8.length > 11 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) return true;
} catch(e) {}
return false;
}
function measureBlob(blob) {
return new Promise((resolve) => {
let img = new Image();
img.onload = () => { let w = img.naturalWidth || 0; let h = img.naturalHeight || 0; URL.revokeObjectURL(img.src); resolve({ w: w, h: h, area: w * h }); };
img.onerror = () => { URL.revokeObjectURL(img.src); resolve({ w: 0, h: 0, area: 0 }); };
img.src = URL.createObjectURL(blob);
});
}
async function storeTextureBlob(name, blob, hintArea, opts) {
opts = opts || {};
if (!blob || !(await isRasterImageBlob(blob))) {
addLog(`跳过不可解码贴图: ${name}`, "warn");
return false;
}
let meta = await measureBlob(blob);
if (meta.area <= 0) {
addLog(`跳过无效贴图数据: ${name}`, "warn");
return false;
}
let quality = await analyzeTextureQuality(blob);
meta.valid = true;
meta.variance = quality.variance;
meta.mean = quality.mean;
meta.source = opts.source || meta.source || "unknown";
let old = getTextureMeta(name);
if (old && old.valid && !opts.forceReplace) {
if (old.area > meta.area) {
addLog(`跳过降级贴图: ${name} (保留 ${old.w}x${old.h}, 拒绝 ${meta.w}x${meta.h})`, "warn");
return false;
}
if (old.area === meta.area && isAlbedoLikeName(name)) {
let oldVar = old.variance || 0;
let newVar = meta.variance || 0;
if (newVar <= oldVar * 1.08 && opts.source !== "gpu") {
addLog(`跳过低质量官方底色: ${name} (方差 ${newVar.toFixed(1)} <= ${oldVar.toFixed(1)})`, "warn");
return false;
}
}
}
unsafeWindow.objects[name] = blob;
unsafeWindow._sf_texMeta[name] = meta;
return true;
}
function rememberUidGpuBest(uid, blob, width, height) {
if (!uid || !blob || width <= 0 || height <= 0) return;
unsafeWindow._sf_uidGpuBest = unsafeWindow._sf_uidGpuBest || {};
let area = width * height;
let prev = unsafeWindow._sf_uidGpuBest[uid];
if (!prev || prev.area < area) unsafeWindow._sf_uidGpuBest[uid] = { blob: blob, w: width, h: height, area: area };
}
async function finalizeTextureObjects() {
unsafeWindow._sf_uidGpuBest = unsafeWindow._sf_uidGpuBest || {};
for (let i = 0; i < originTextureArr.length; i++) {
let tex = originTextureArr[i]; let officialName = tex.name; if (!officialName || !tex.uid) continue;
let gpu = unsafeWindow._sf_uidGpuBest[tex.uid]; if (!gpu) continue;
let old = getTextureMeta(officialName);
let gpuQuality = await analyzeTextureQuality(gpu.blob);
let oldVar = old && old.variance ? old.variance : 0;
let preferGpu = false;
if (isAlbedoLikeName(officialName)) {
if (!old || !old.valid) preferGpu = true;
else if (gpu.area >= old.area) preferGpu = gpuQuality.variance > oldVar * 1.05 || gpu.area > old.area;
else preferGpu = gpuQuality.variance > oldVar * 1.35;
} else if (!old || !old.valid || gpu.area > old.area) {
preferGpu = true;
}
if (preferGpu) {
if (await storeTextureBlob(officialName, gpu.blob, gpu.area, { forceReplace: true, source: "gpu" })) {
addLog(`GPU显存优先替换 -> ${officialName} [${gpu.w}x${gpu.h}] 方差:${gpuQuality.variance.toFixed(1)}`, "success");
} else if (old && old.valid) {
addLog(`贴图源: ${officialName} 保留现有 [${old.w}x${old.h}] 方差:${oldVar.toFixed(1)}`, "info");
}
} else if (old && old.valid) {
addLog(`贴图源: ${officialName} 保留官方URL [${old.w}x${old.h}] 方差:${oldVar.toFixed(1)}`, "info");
}
}
for (let k in unsafeWindow.objects) {
if (k.indexOf("tex_catch_") === 0) { delete unsafeWindow.objects[k]; if (unsafeWindow._sf_texMeta[k]) delete unsafeWindow._sf_texMeta[k]; }
}
addLog(`贴图池已清理：移除 tex_catch 临时名，保留官方命名高清贴图。`, "info");
}
function scheduleAutoDump(reason) { if (!(unsafeWindow._sf_auto && unsafeWindow._sf_auto.autoTextureDump)) return;
if (unsafeWindow.isDumping || (unsafeWindow._sf_flags && unsafeWindow._sf_flags.texturesReady)) return;
if (autoDumpTimer) clearTimeout(autoDumpTimer);
let delay = (reason === "prefetchedData_loaded") ? 4500 : 2800;
autoDumpTimer = setTimeout(() => {
if (unsafeWindow.isDumping || (unsafeWindow._sf_flags && unsafeWindow._sf_flags.texturesReady)) return;
addLog(`自动化策略触发：检测到贴图流已进入稳定阶段，开始抓取高清贴图（触发源: ${reason}）。`, "info");
dumpWebGLTextureData();
}, delay);
}
async function waitForTextureMetadataReady(maxWaitMs = 20000) {
let start = Date.now(); let prevScore = -1; let stableTicks = 0;
while ((Date.now() - start) < maxWaitMs) {
let score = 0;
if (originTextureArr && originTextureArr.length > 0) {
for (let i = 0; i < originTextureArr.length; i++) {
let best = pickBestImage(originTextureArr[i].images || []);
if (best) score += Number(best.width || 0) * Number(best.height || 0);
}
}
if (score > 0 && score === prevScore) stableTicks++;
else stableTicks = 0;
prevScore = score;
if (score > 0 && stableTicks >= 3) {
addLog(`高清贴图元数据已稳定（评分:${score}），进入抓取。`, "success");
return;
}
await new Promise(r => setTimeout(r, 900));
}
addLog("等待高清贴图元数据超时，继续抓取当前可用最高版本。", "warn");
}
function refreshTextureCatalog() {
originTextureArr = getTextureCatalog();
coverTexture(originTextureArr);
addLog(`贴图目录已合并：${originTextureArr.length} 张（含 optimized + 原图接口）`, "info");
return originTextureArr;
}
window.onload = () => { try{
refreshTextureCatalog();
/* V9.9.1: 网页加载完毕后立即开放点击提取，彻底绕过底层对 KTX 压缩大格式抓取不到导致死锁禁用的问题 */
var btnTex = document.getElementById("sf-btn-tex"); if(btnTex && originTextureArr.length > 0) { btnTex.innerText = "📥 提取高清贴图矩阵 (需手动点击)"; btnTex.style.background = "#f0ad4e"; btnTex.disabled = false; btnTex.onclick = dumpWebGLTextureData; }
scheduleAutoDump("prefetchedData_loaded");
}catch(e){ addLog("未能预读贴图表。", "warn"); } }
function coverTexture(results){ results.forEach((texture)=>{ if (!texture.images || texture.images.length === 0) return; let img = pickBestImage(texture.images); if(img) texture.url = img.url; /* 撤销原版强行替换，防止加载卡死: images.forEach((item,idx)=>{ images[idx] = img; }) */ }) }
let webGLTextureIdx = 0; let webGLTextureMap = {}; let lstTexture; let hasCoverTex = 0; let isDumpScheduled = false;
function hookGL(targetCtx) { if(!targetCtx) return; let glCreateTexture = targetCtx.prototype.createTexture; targetCtx.prototype.createTexture = function (...args) { let texture = glCreateTexture.apply(this, args); texture.name = webGLTextureIdx; texture.gl = this; webGLTextureMap[`${webGLTextureIdx}`] = texture; webGLTextureIdx++; return texture; };
let glActiveTexture = targetCtx.prototype.activeTexture; targetCtx.prototype.activeTexture = function (...args) { this._sf_activeTextureUnit = args[0] - this.TEXTURE0; return glActiveTexture.apply(this, args); };
let glBindTexture = targetCtx.prototype.bindTexture; targetCtx.prototype.bindTexture = function (...args) { let target = args[0], texture = args[1]; if (texture) texture.target = target;
if (target === this.TEXTURE_2D || target === this.TEXTURE_CUBE_MAP) { let unit = this._sf_activeTextureUnit || 0; unsafeWindow._sf_globalBoundTextures[unit] = texture ? texture.name : -1; } return glBindTexture.apply(this, args); };
let glDeleteTexture = targetCtx.prototype.deleteTexture; targetCtx.prototype.deleteTexture = function (...args) { };
let glTexImage2D = targetCtx.prototype.texImage2D; targetCtx.prototype.texImage2D = function (...args) { let texture = this.getParameter(this.TEXTURE_BINDING_2D) || this.getParameter(this.TEXTURE_BINDING_CUBE_MAP);
let argments = parseTexImage2dArgs(args); if (texture && texture.target == argments.target) { if (argments.level === 0 || !texture.args) { texture.args = argments; }
let { width, height, src, level } = argments; if (level === 0 && width >= 16 && height >= 16 && texture.target === this.TEXTURE_2D) { if (src && !texture.srcLogged) { texture.src = argments.src; if (lstTexture) { lstTexture.lst = texture.name; } hasCoverTex++; texture.srcLogged = true;
var btnTex = document.getElementById("sf-btn-tex"); if(btnTex && btnTex.innerText.includes("等待")) { btnTex.innerText = "📥 提取高清贴图矩阵"; btnTex.style.background = "#f0ad4e"; btnTex.disabled = false; btnTex.onclick = dumpWebGLTextureData; }
scheduleAutoDump("webgl_tex_stream");
} lstTexture = texture; } } glTexImage2D.apply(this, args); }; }
hookGL(unsafeWindow.WebGLRenderingContext); hookGL(unsafeWindow.WebGL2RenderingContext);
function parseTexImage2dArgs(args) { let argments = {}; if (args.length == 6) { let [target, level, internalformat, format, type, source] = args; let { width, height, src } = source; argments = { target, level, width, height,internalformat, format, type, src }; } else if (args.length == 9) { let [target, level, internalformat, width, height, border, format, type, pixels] = args;
argments = { target, level, width, height, format,internalformat, type }; } else { let [target] = args; argments = { target }; } return argments; }
let processedCnt = 0; let successCnt = 0;
async function checkDone(totalLength) {
processedCnt++;
if (processedCnt >= totalLength) {
await finalizeTextureObjects();
unsafeWindow.isDumping = false;
unsafeWindow._sf_flags.texturesReady = true;
addLog(`系统汇报：全量无损保存 ${successCnt} 张！`, "success");
var btnTex = document.getElementById("sf-btn-tex");
if(btnTex) { btnTex.innerText = "✅ 抓取完成 (可生成GLB)"; btnTex.style.background = "#5cb85c"; btnTex.disabled = false; }
tryAutoExport("textures_ready");
}
}
/* V9.9 原有同步提取逻辑，保留作为孤儿贴图的退路 */
function readWebTextureData(texture, index, totalLength) { let { target, gl, args, src, lst } = texture; if (!args) { checkDone(totalLength); return; } let { level, width, height } = args;
if (level === 0 && width >= 16 && height >= 16 && target === gl.TEXTURE_2D && !src) { let fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE) {
let originName = `tex_catch_${texture.name}.png`; let mapUid = null; let originTex = webGLTextureMap[lst];
if (originTex && originTex.src) { let path = originTex.src.split("/"); mapUid = path[path.length - 2]; let fn = getNameById(mapUid); if(fn) originName = fn; }
if (!mapUid && texture.src) { let path2 = String(texture.src).split("/"); mapUid = path2[path2.length - 2]; let fn2 = getNameById(mapUid); if(fn2) originName = fn2; }
unsafeWindow.textureIdMap[originName] = texture.name;
let pixels = new Uint8Array(width * height * 4); try { gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
let canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; let context = canvas.getContext("2d"); let imageData = context.createImageData(width, height); imageData.data.set(flipY(pixels, width, height)); context.putImageData(imageData, 0, 0);
canvas.toBlob(async (blob) => {
if (mapUid) rememberUidGpuBest(mapUid, blob, width, height);
let oldMeta = getTextureMeta(originName);
let shouldStore = !oldMeta || !oldMeta.valid || width * height >= oldMeta.area || isAlbedoLikeName(originName);
if (shouldStore) {
if (await storeTextureBlob(originName, blob, width * height, { source: "gpu" })) { successCnt++; addLog(`GPU显存抓取 -> ${originName} [${width}x${height}]`, "info"); }
} else {
addLog(`GPU显存已缓存(待finalize替换): ${originName} [${width}x${height}]`, "info");
}
checkDone(totalLength);
}, "image/png"); return; } catch(e) { } } gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); } checkDone(totalLength); }
function flipY(arr, width, height) { const length = width * height * 4; const row = width * 4; const end = (height - 1) * row; const pixels = new Uint8Array(length); for (let i = 0; i < length; i += row) pixels.set(arr.subarray(i, i + row), end - i); return pixels; }
async function dumpWebGLTextureData() { if(unsafeWindow.isDumping) return; unsafeWindow.isDumping = true; processedCnt = 0; successCnt = 0;
var btnTex = document.getElementById("sf-btn-tex"); if(btnTex) { btnTex.innerText = "⏳ 正在直连抓取高清贴图..."; btnTex.disabled = true; }
refreshTextureCatalog();
await fetchMatcapsIntoCatalog();
await waitForTextureMetadataReady();
/* V9.9.1: 完全摆脱对 WebGL 挂钩顺序的依赖，保证官方贴图绝对被高清下载，不会空载变成顶点色马赛克 */
if (originTextureArr && originTextureArr.length > 0) { addLog(`启动直连引擎，拉取 ${originTextureArr.length} 张官方贴图...`, "info");
for (let i = 0; i < originTextureArr.length; i++) { let tex = originTextureArr[i]; let officialName = tex.name || `tex_${tex.uid}.png`; try {
let maxImg = null; if (tex.images && tex.images.length > 0) { maxImg = pickBestImage(tex.images); } else if (tex.url) { maxImg = { url: tex.url }; }
if (maxImg) {
let res = await fetch(maxImg.url); let blob = await res.blob();
if (await storeTextureBlob(officialName, blob, 0, { source: "official" })) {
successCnt++;
let m = getTextureMeta(officialName);
addLog(`官方高清入库 -> ${officialName} [${m ? (m.w + "x" + m.h) : "未知尺寸"}] 方差:${m && m.variance ? m.variance.toFixed(1) : "?"}${tex._isMatcap ? " [Matcap]" : ""}`, "success");
} else {
addLog(`官方URL不可解码，等待GPU回填: ${officialName}`, "warn");
}
} } catch(e) { addLog(`拉取失败: ${officialName}`, "warn"); } } }
let texturesToExtract = []; for (let key in webGLTextureMap) { if(webGLTextureMap[key].args && !webGLTextureMap[key].src && webGLTextureMap[key].args.level === 0) texturesToExtract.push(webGLTextureMap[key]); }
if (texturesToExtract.length === 0) {
await finalizeTextureObjects();
unsafeWindow.isDumping = false; unsafeWindow._sf_flags.texturesReady = true; addLog(`贴图全量处理完毕！共 ${successCnt} 张，请提取模型。`, "success"); if(btnTex) { btnTex.innerText = "✅ 贴图就绪 (可生成 GLB)"; btnTex.style.background = "#5cb85c"; btnTex.disabled = false; } tryAutoExport("textures_direct_done"); return; }
addLog(`检测到 ${texturesToExtract.length} 张显存孤儿贴图，开始离线重塑...`, "info");
texturesToExtract.forEach((tex, i) => { setTimeout(() => { readWebTextureData(tex, i, texturesToExtract.length); }, i * 150); }); }
function getNameById(uid) { let name; let texture = originTextureArr.find((t) => t.uid == uid); if (texture) name = texture.name; return name; } })();