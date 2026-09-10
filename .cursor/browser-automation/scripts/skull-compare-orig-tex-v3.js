/**
 * 并排自测：原版 / tex / v3，截图对比碎三角。
 * 需 http://127.0.0.1:18080 仓库根静态服务。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const RUNS = path.join(__dirname, "../runs");
const MANAGER =
  "http://127.0.0.1:18080/" +
  encodeURI("自用工具文件_不部署/GBL管理器/Glb管理器.html");

const FILES = [
  {
    key: "orig",
    file: path.join(ROOT, "自用工具文件_不部署/头骨分色骨缝/input/human02_raw.glb"),
  },
  {
    key: "tex",
    file: path.join(ROOT, "自用工具文件_不部署/头骨分色骨缝/out/human02_parts_color_tex.glb"),
  },
  {
    key: "v3",
    file: path.join(ROOT, "自用工具文件_不部署/头骨分色骨缝/out/human02_parts_color_v3.glb"),
  },
];

async function loadGlb(page, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  await page.evaluate(
    async ({ b64, name }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__AGENT_LOAD_GLB_BUFFER__(bin.buffer, name);
    },
    { b64, name }
  );
  await page.waitForTimeout(1800);
}

async function probe(page) {
  return page.evaluate(() => {
    const sc = window.__AGENT_PROCESSING_SCENE__;
    if (!sc || !sc.scene) return { err: "no scene" };
    let meshes = 0;
    let withNorm = 0;
    let doubleSide = 0;
    let frontSide = 0;
    let mapW = 0;
    let minFilter = null;
    let genMip = null;
    sc.scene.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      meshes++;
      if (n.geometry.getAttribute("normal")) withNorm++;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.side === 2) doubleSide++;
        if (m.side === 0) frontSide++;
        if (m.map) {
          mapW = Math.max(mapW, (m.map.image && m.map.image.width) || 0);
          minFilter = m.map.minFilter;
          genMip = m.map.generateMipmaps;
        }
      });
    });
    const mv = document.getElementById("main-viewer");
    return {
      meshes,
      withNorm,
      doubleSide,
      frontSide,
      mapW,
      minFilter,
      genMip,
      shadow: mv && mv.getAttribute("shadow-intensity"),
      side: (() => {
        // THREE.FrontSide=0, BackSide=1, DoubleSide=2
        return { FrontSide: 0, BackSide: 1, DoubleSide: 2 };
      })(),
    };
  });
}

async function main() {
  fs.mkdirSync(RUNS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(MANAGER, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === "function", null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    localStorage.setItem("prefer_pbr_preview", "1");
    localStorage.setItem("light_mode", "natural");
    const el = document.getElementById("check-prefer-pbr");
    if (el) el.checked = true;
    const tex = document.getElementById("sel-tex-size");
    if (tex) tex.value = "0";
    const mv = document.getElementById("main-viewer");
    if (mv) {
      mv.setAttribute("shadow-intensity", "0");
    }
  });

  const report = { shots: {}, probes: {} };
  for (const item of FILES) {
    if (!fs.existsSync(item.file)) {
      report.probes[item.key] = { err: "missing " + item.file };
      continue;
    }
    await loadGlb(page, item.file, path.basename(item.file));
    report.probes[item.key] = await probe(page);
    const shot = path.join(RUNS, `skull-compare-${item.key}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    report.shots[item.key] = shot;
    console.log(item.key, JSON.stringify(report.probes[item.key]));
  }

  fs.writeFileSync(path.join(RUNS, "skull-compare-report.json"), JSON.stringify(report, null, 2));
  console.log("COMPARE_OK", JSON.stringify(report.probes));
  await browser.close();
}

main().catch((e) => {
  console.error("COMPARE_FAIL", e);
  process.exit(1);
});
