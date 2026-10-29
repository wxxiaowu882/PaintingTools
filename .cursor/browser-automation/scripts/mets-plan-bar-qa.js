/**
 * METS 背词：计划条/喇叭顶右/红旗/底栏分数/长按英文不跳/连闪不计计划
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const REPO = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(REPO, "临时_METS二级备考", "05_背词网页");
const outDir = path.join(__dirname, "..", "runs", "mets-plan-bar-qa");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [], notes: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}
function note(s) {
  report.notes.push(s);
}
function fileHash(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function applySettings(page, extra = {}) {
  return page.evaluate((extra) => {
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
        immerseAudioOn: true,
        achieveDailyValidCap: 3,
        achieveStreakNeed: 10,
        planDailyRounds: 3,
        planRoundSize: 5,
        planMiniEvery: 2,
        ...extra,
      })
    );
  }, extra);
}

async function enterImmerse(page) {
  await page.waitForSelector("button:has-text('进入学习')", { timeout: 20000 });
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-root", { timeout: 15000 });
}

async function clickNext(page) {
  const box = await page.locator(".immerse-stage").boundingBox();
  if (!box) throw new Error("no immerse-stage");
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.55);
}

(async () => {
  for (const rel of [
    ["js/ui-plan-bar.js", "dist/js/ui-plan-bar.js"],
    ["js/ui-recall.js", "dist/js/ui-recall.js"],
    ["js/ui-flash.js", "dist/js/ui-flash.js"],
    ["js/achieve.js", "dist/js/achieve.js"],
    ["css/app.css", "dist/css/app.css"],
  ]) {
    const a = path.join(SRC, rel[0]);
    const b = path.join(SRC, rel[1]);
    check(
      `${path.basename(rel[0])} 源=dist`,
      fs.existsSync(a) && fs.existsSync(b) && fileHash(a) === fileHash(b),
      rel.join(" ↔ ")
    );
  }

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(String(e.message || e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await applySettings(page, { immerseAudioOn: false });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await enterImmerse(page);
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(500);

  check(
    "英：有计划进度条",
    (await page.locator(".immerse-plan-bar").count()) === 1
  );
  const rounds = await page.locator(".immerse-plan-node--round").count();
  const minis = await page.locator(".immerse-plan-node--mini").count();
  check("轮次节点=3", rounds === 3, `rounds=${rounds}`);
  check("无小阶段点", minis === 0, `minis=${minis}`);
  check(
    "无问号帮助",
    (await page.locator(".immerse-help-btn, .immerse-help").count()) === 0
  );
  check(
    "喇叭在顶栏右",
    (await page.locator(".immerse-top-trail .immerse-speaker--top").count()) ===
      1
  );
  check(
    "勋章挂在进度条槽",
    (await page.locator(".immerse-plan-medal-slot .immerse-medal--onbar").count()) ===
      1
  );

  const foot0 = (await page.locator(".immerse-foot").innerText()).trim();
  check(
    "底栏为有效/总量格式",
    /^\d+\s*\/\s*\d+$/.test(foot0),
    foot0
  );
  check("底栏无场景名", !/场景|词/.test(foot0), foot0);

  const barGeom = await page.evaluate(() => {
    const track = document.querySelector(".immerse-plan-track");
    const fill = document.querySelector(".immerse-plan-fill");
    if (!track || !fill) return null;
    const ts = getComputedStyle(track);
    return {
      h: parseFloat(ts.height),
      fillOpacity: getComputedStyle(fill).opacity,
      fillBg: ts.backgroundColor,
    };
  });
  check(
    "进度条细(≤3px)",
    barGeom && barGeom.h > 0 && barGeom.h <= 3,
    JSON.stringify(barGeom)
  );

  // 长按：英文 Y 不变
  const enBefore = await page.evaluate(() => {
    const el = document.querySelector(".immerse-prompt-main .flash-en");
    return el ? el.getBoundingClientRect().top : null;
  });
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const holdState = await page.evaluate(() => {
    const main = document.querySelector(".immerse-prompt-main .flash-en");
    const ans = document.querySelector(".immerse-prompt-answer");
    return {
      enTop: main ? main.getBoundingClientRect().top : null,
      ansOn: ans ? ans.classList.contains("is-on") : false,
      ansOpacity: ans ? getComputedStyle(ans).opacity : null,
    };
  });
  await page.mouse.up();
  check("长按已揭中文", holdState.ansOn, JSON.stringify(holdState));
  check(
    "揭开后英文Y不变",
    enBefore != null &&
      holdState.enTop != null &&
      Math.abs(holdState.enTop - enBefore) < 1.5,
    `before=${enBefore} after=${holdState.enTop}`
  );

  await page.screenshot({
    path: path.join(outDir, "01-en-hold.png"),
    fullPage: false,
  });

  // 手动推到轮次节点 → 红旗
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await applySettings(page, {
    planDailyRounds: 2,
    planRoundSize: 2,
    immerseAudioOn: false,
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await enterImmerse(page);
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(400);

  for (let i = 0; i < 2; i++) {
    await clickNext(page);
    await page.waitForTimeout(280);
  }
  const flags = await page.locator(".immerse-plan-node--round.is-flag").count();
  check("到达第1轮变红旗", flags >= 1, `flags=${flags}`);

  const foot1 = (await page.locator(".immerse-foot").innerText()).trim();
  check("底栏仍为分数格式", /^\d+\s*\/\s*\d+$/.test(foot1), foot1);

  const celebrate = await page.evaluate(() => ({
    round: !!document.querySelector(".achieve-fx--round"),
    mini: !!document.querySelector(".achieve-fx--mini"),
    day: !!document.querySelector(".achieve-fx--day"),
    heart: !!document.querySelector(".immerse-plan-heart"),
  }));
  check(
    "无阶段/轮庆祝",
    !celebrate.round && !celebrate.mini && !celebrate.day && !celebrate.heart,
    JSON.stringify(celebrate)
  );

  const medalLeft = await page.evaluate(() => {
    const slot = document.querySelector(".immerse-plan-medal-slot");
    return slot ? slot.style.left : "";
  });
  check(
    "勋章随进度移动",
    !!medalLeft && medalLeft !== "0%" && parseFloat(medalLeft) > 0,
    medalLeft
  );

  await page.screenshot({
    path: path.join(outDir, "02-flag-medal.png"),
    fullPage: false,
  });

  // 连闪不计计划
  const ticksBefore = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "{}")
        .ticks;
    } catch (_) {
      return null;
    }
  });
  const stage = await page.locator(".immerse-stage").boundingBox();
  // 双击开连闪
  await page.mouse.dblclick(
    stage.x + stage.width * 0.5,
    stage.y + stage.height * 0.55
  );
  await page.waitForTimeout(2200);
  const ticksAfter = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "{}")
        .ticks;
    } catch (_) {
      return null;
    }
  });
  check(
    "连闪不计计划ticks",
    ticksBefore === ticksAfter,
    `before=${ticksBefore} after=${ticksAfter}`
  );

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  note("已清理页面 localStorage/sessionStorage");

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
