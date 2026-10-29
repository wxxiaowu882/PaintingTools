/**
 * METS UI polish：渐显 / 勋章旗在条上 / 成就之路顶栏精简
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-ui-polish-qa");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(String(e.message || e)));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      "mets-l2-settings-v1",
      JSON.stringify({
        groupSize: 100,
        flashIntervalMs: 800,
        voiceChannel: "both",
        playbackRate: 1,
        showIpa: true,
        showFreq: true,
        listCols: "both",
        lastStudyMode: "recallZh",
        immerseTheme: "night",
        immerseAudioOn: false,
        achieveDailyValidCap: 3,
        achieveStreakNeed: 10,
        planDailyRounds: 2,
        planRoundSize: 2,
        planMiniEvery: 1,
      })
    );
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-root", { timeout: 15000 });
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(400);

  const fadeMs = await page.evaluate(() => {
    const el = document.querySelector(".immerse-prompt-answer");
    return el ? getComputedStyle(el).transitionDuration : null;
  });
  check(
    "答案渐显 transition≥0.25s",
    fadeMs && parseFloat(fadeMs) >= 0.25,
    String(fadeMs)
  );

  const geom = await page.evaluate(() => {
    const track = document.querySelector(".immerse-plan-track");
    const medal = document.querySelector(".immerse-plan-medal-slot");
    if (!track || !medal) return null;
    const tr = track.getBoundingClientRect();
    const mr = medal.getBoundingClientRect();
    return {
      trackTop: tr.top,
      medalBottom: mr.bottom,
      gap: tr.top - mr.bottom,
    };
  });
  check(
    "勋章在条上方且有间隙",
    geom && geom.gap >= 4,
    JSON.stringify(geom)
  );

  const box = await page.locator(".immerse-stage").boundingBox();
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.55);
    await page.waitForTimeout(280);
  }
  const flagGeom = await page.evaluate(() => {
    const track = document.querySelector(".immerse-plan-track");
    const flag = document.querySelector(".immerse-plan-node--round.is-flag");
    if (!track || !flag) return null;
    const tr = track.getBoundingClientRect();
    const fr = flag.getBoundingClientRect();
    return {
      trackTop: tr.top,
      flagBottom: fr.bottom,
      gap: tr.top - fr.bottom,
    };
  });
  check("有红旗", !!flagGeom, JSON.stringify(flagGeom));
  check(
    "红旗在条上方且有间隙",
    flagGeom && flagGeom.gap >= 3,
    JSON.stringify(flagGeom)
  );
  await page.screenshot({
    path: path.join(outDir, "01-bar-icons.png"),
    fullPage: false,
  });

  await page.locator(".immerse-medal--onbar").click();
  await page.waitForTimeout(500);
  const ap = await page.evaluate(() => {
    const search = document.getElementById("btn-search");
    const settings = document.getElementById("btn-settings");
    return {
      backBtn: !!document.querySelector("#ap-back"),
      h2: Array.from(document.querySelectorAll("h2")).some((h) =>
        (h.textContent || "").includes("成就之路")
      ),
      topTitle: (document.getElementById("top-title") || {}).textContent || "",
      stats:
        (document.querySelector(".achieve-path-head .tiny") || {}).textContent ||
        "",
      searchHidden: !!search?.hidden,
      settingsHidden: !!settings?.hidden,
      searchW: search ? search.getBoundingClientRect().width : -1,
      settingsW: settings ? settings.getBoundingClientRect().width : -1,
      hasTopBack: !!document.querySelector(".topbar-back"),
    };
  });
  check("无页内返回钮", !ap.backBtn);
  check(
    "无成就之路标题字",
    !ap.h2 && !(ap.topTitle || "").includes("成就之路"),
    JSON.stringify({ h2: ap.h2, top: ap.topTitle })
  );
  check("保留统计副文案", /英→中已掌握/.test(ap.stats), ap.stats);
  check("搜词隐藏", ap.searchHidden);
  check("设置隐藏", ap.settingsHidden);
  check(
    "搜词不可见(宽=0)",
    ap.searchW === 0,
    `w=${ap.searchW}`
  );
  check(
    "设置不可见(宽=0)",
    ap.settingsW === 0,
    `w=${ap.settingsW}`
  );
  check("顶栏静默返回仍在", ap.hasTopBack);
  await page.screenshot({
    path: path.join(outDir, "02-achieve-path.png"),
    fullPage: false,
  });

  await page.locator(".topbar-back").click();
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => ({
    searchHidden: !!document.getElementById("btn-search")?.hidden,
    settingsHidden: !!document.getElementById("btn-settings")?.hidden,
  }));
  check("离页后搜词恢复", !restored.searchHidden);
  check("离页后设置恢复", !restored.settingsHidden);

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await browser.close();
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok && report.errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
