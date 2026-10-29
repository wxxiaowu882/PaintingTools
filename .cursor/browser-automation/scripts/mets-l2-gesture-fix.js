const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "../runs/mets-l2-gesture-fix");
fs.mkdirSync(out, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const results = [];
  const audioReqs = [];
  page.on("request", (req) => {
    if (/\.mp3(\?|$)/i.test(req.url())) audioReqs.push(req.url());
  });

  await page.goto("http://127.0.0.1:18780/", { waitUntil: "networkidle" });

  await page.click('button:has-text("选词库")');
  await page.click('.scene-item:has-text("按场景")');
  await page.waitForTimeout(250);
  await page.locator(".check-item").first().locator("input").check();
  await page.click('button:has-text("进入")');
  await page.waitForTimeout(400);

  const modes = await page.$$eval(".mode-bar .btn", (els) =>
    els.map((e) => e.textContent.trim())
  );
  assert(
    modes.includes("闪记中文") &&
      modes.includes("闪记忆英文") &&
      !modes.includes("闪忆"),
    "mode buttons split: " + modes.join(",")
  );
  results.push({ modes });

  audioReqs.length = 0;
  await page.click('.mode-bar button:has-text("闪记")');
  await page.waitForTimeout(800);
  assert(
    audioReqs.length === 0,
    "flash first word must NOT auto-play, got " + audioReqs.length
  );
  assert((await page.locator(".card-immerse-btn").count()) === 1, "card immerse icon");
  results.push({ firstNoAudio: true });

  await page.click(".card-immerse-btn");
  await page.waitForTimeout(600);
  assert(
    await page.evaluate(() => document.body.classList.contains("immersed")),
    "immersed"
  );

  const status = () => page.textContent(".immerse-status");
  const prog = () => page.textContent(".immerse-root .prog");
  const box = await page.locator(".immerse-stage").boundingBox();
  assert(box, "stage box");

  async function tap(x, y) {
    await page.mouse.click(x, y, { delay: 30 });
    await page.waitForTimeout(360);
  }
  async function dblTap(x, y) {
    await page.mouse.click(x, y, { delay: 20 });
    await page.waitForTimeout(80);
    await page.mouse.click(x, y, { delay: 20 });
    await page.waitForTimeout(120);
  }

  const startProg = await prog();
  assert(startProg.startsWith("1 /"), "start at 1, got " + startProg);
  let st = await status();
  assert(/已暂停/.test(st) && !/自动连闪中/.test(st), "initial paused: " + st);

  await tap(box.x + box.width * 0.88, box.y + box.height * 0.12);
  st = await status();
  const afterRight = await prog();
  assert(/已暂停/.test(st), "single right must NOT start auto: " + st);
  assert(afterRight.startsWith("2 /"), "single right → next: " + afterRight);
  results.push({ singleRight: { afterRight, st } });

  await tap(box.x + box.width * 0.12, box.y + box.height * 0.12);
  st = await status();
  const afterLeft = await prog();
  assert(/已暂停/.test(st), "single left must NOT start auto: " + st);
  assert(afterLeft.startsWith("1 /"), "single left → prev: " + afterLeft);
  results.push({ singleLeft: { afterLeft, st } });

  const enBox = await page.locator(".immerse-stage .flash-en.immerse-speak").boundingBox();
  const audioBeforeSpeak = audioReqs.length;
  await tap(enBox.x + enBox.width / 2, enBox.y + enBox.height / 2);
  st = await status();
  const afterSpeak = await prog();
  assert(/已暂停/.test(st), "speak tap must NOT toggle auto: " + st);
  assert(afterSpeak === afterLeft, "speak keeps index: " + afterSpeak);
  assert(audioReqs.length > audioBeforeSpeak, "speak should request audio");
  results.push({
    speakTap: { afterSpeak, audioAdded: audioReqs.length - audioBeforeSpeak },
  });

  await dblTap(box.x + box.width * 0.12, box.y + box.height * 0.12);
  st = await status();
  assert(/自动连闪中/.test(st), "double tap starts auto: " + st);
  results.push({ dblOn: st });

  await dblTap(box.x + box.width * 0.12, box.y + box.height * 0.12);
  st = await status();
  assert(/已暂停/.test(st), "double tap stops auto: " + st);
  results.push({ dblOff: st });

  const p0 = await prog();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.55, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const afterSwipe = await prog();
  const n0 = Number(String(p0).split("/")[0].trim());
  const n1 = Number(String(afterSwipe).split("/")[0].trim());
  const total = Number(String(p0).split("/")[1].trim());
  const expect = (n0 % total) + 1;
  assert(n1 === expect, `swipe left next expect ${expect} got ${n1} (${p0}->${afterSwipe})`);
  results.push({ swipe: { p0, afterSwipe } });

  await page.screenshot({ path: path.join(out, "immerse.png") });
  await page.click(".immerse-exit");
  await page.waitForTimeout(400);

  await page.click('.mode-bar button:has-text("闪记中文")');
  await page.waitForTimeout(500);
  let hints = await page.$$eval("#study-body p", (els) => els.map((e) => e.textContent));
  assert(
    hints.some((h) => /看英文，想中文/.test(h || "")),
    "recallZh hint: " + JSON.stringify(hints)
  );

  await page.click('.mode-bar button:has-text("闪记忆英文")');
  await page.waitForTimeout(500);
  hints = await page.$$eval("#study-body p", (els) => els.map((e) => e.textContent));
  assert(
    hints.some((h) => /看中文，想英文/.test(h || "")),
    "recallEn hint: " + JSON.stringify(hints)
  );

  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}").lastStudyMode
  );
  assert(saved === "recallEn", "lastStudyMode saved: " + saved);

  await page.click('.tab[data-tab="me"]');
  await page.waitForTimeout(300);
  assert((await page.locator("#set-rate").count()) === 1, "speed slider");
  assert((await page.locator("#set-dir").count()) === 0, "no recall direction");
  await page.evaluate(() => {
    const el = document.querySelector("#set-rate");
    if (el) {
      el.value = "1.2";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.click("#set-save");
  const rate = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mets-l2-settings-v1")).playbackRate
  );
  assert(Number(rate) === 1.2, "playbackRate: " + rate);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const activeMode = await page
    .$eval(".mode-bar .btn.primary", (e) => e.textContent.trim())
    .catch(() => null);
  assert(activeMode === "闪记忆英文", "restored mode: " + activeMode);

  await page.screenshot({ path: path.join(out, "restored.png") });
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify({ pass: true, results }, null, 2)
  );
  console.log(JSON.stringify({ pass: true, results }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify({ pass: false, error: String(e) }, null, 2)
  );
  process.exit(1);
});
