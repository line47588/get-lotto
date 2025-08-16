import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const LIST_URL = "https://news.sanook.com/lotto/";
const DATA_DIR = path.join(process.cwd(), "data");
await fs.promises.mkdir(DATA_DIR, { recursive: true });

const TH_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

function thaiDateToYMD(dateStr) {
  const m = dateStr.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4})/);
  if (!m) return null;
  const d = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(TH_MONTHS.indexOf(m[2]) + 1).padStart(2, "0");
  const yearBE = parseInt(m[3], 10);
  const year = yearBE - 543;
  return `${year}${mm}${d}`;
}

function squash(s) {
  if (!s) return "";
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n");
}
function onlyDigitsArr(arr) {
  return (arr || []).map(x => x.trim()).filter(Boolean);
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0" });

  // 1) หน้า list หา link งวดล่าสุด (href มี /lotto/check/)
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded" });
  const latestHref = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll("a[href*='/lotto/check/']"));
    return as.length ? new URL(as[0].getAttribute("href"), location.href).href : null;
  });
  if (!latestHref) {
    await browser.close();
    throw new Error("ไม่พบลิงก์งวดล่าสุดจากหน้า list");
  }

  // 2) เข้าไปหน้า check งวดล่าสุด
  await page.goto(latestHref, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const rawText = await page.evaluate(() => document.body.innerText || "");
  const html = await page.content();
  await browser.close();

  const textFlat = squash(rawText);

  // วันที่ไทย
  const dateTH =
    (textFlat.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    (textFlat.match(/ประจำงวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    "";

  const ymd = thaiDateToYMD(dateTH) || "00000000";

  // เก็บดีบัก
  fs.writeFileSync(path.join(DATA_DIR, `raw-${ymd}.txt`), textFlat);
  fs.writeFileSync(path.join(DATA_DIR, `html-${ymd}.html`), html);

  // ========= พยายามจับตัวเลขหลายรูปแบบ =========
  // รางวัลที่ 1
  let prizeFirst =
    (textFlat.match(/รางวัลที่\s*1[^\d]+(\d{6})/) || [])[1] ||
    (textFlat.match(/รางวัลที่หนึ่ง[^\d]+(\d{6})/) || [])[1] || "";

  // ข้างเคียงรางวัลที่ 1
  let nearBlock =
    (textFlat.match(/ข้างเคียงรางวัลที่\s*1[^0-9]+((?:\d{6}[^\d]{0,5}){1,2})/) || [])[1] || "";
  let prizeFirstNear = onlyDigitsArr(nearBlock.match(/\d{6}/g));

  // เลขหน้า 3 ตัว
  let frontBlock =
    (textFlat.match(/เลขหน้า\s*3\s*ตัว[^0-9]+((?:\d{3}[^\d]{0,3}){1,4})/) || [])[1] || "";
  let front3 = onlyDigitsArr(frontBlock.match(/\b\d{3}\b/g));

  // เลขท้าย 3 ตัว
  let back3Block =
    (textFlat.match(/เลขท้าย\s*3\s*ตัว[^0-9]+((?:\d{3}[^\d]{0,3}){1,4})/) || [])[1] || "";
  let back3 = onlyDigitsArr(back3Block.match(/\b\d{3}\b/g));

  // เลขท้าย 2 ตัว
  let back2 = (textFlat.match(/เลขท้าย\s*2\s*ตัว[^0-9]+(\d{2})/) || [])[1] || "";
  let back2Arr = back2 ? [back2] : [];

  // ถ้ายังว่าง ลองจาก HTML flatten อีกที
  if (!prizeFirst || !front3.length || !back3.length || !back2Arr.length || !prizeFirstNear.length) {
    const htmlFlat = squash(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (!prizeFirst) {
      prizeFirst = (htmlFlat.match(/รางวัลที่\s*1[^\d]+(\d{6})/) || [])[1] || "";
    }
    if (!front3.length) {
      const f2 = (htmlFlat.match(/เลขหน้า\s*3\s*ตัว[^0-9]+((?:\d{3}[^0-9]{0,5}){1,4})/) || [])[1] || "";
      const arr = f2.match(/\b\d{3}\b/g);
      if (arr) front3 = onlyDigitsArr(arr);
    }
    if (!back3.length) {
      const b3 = (htmlFlat.match(/เลขท้าย\s*3\s*ตัว[^0-9]+((?:\d{3}[^0-9]{0,5}){1,4})/) || [])[1] || "";
      const arr = b3.match(/\b\d{3}\b/g);
      if (arr) back3 = onlyDigitsArr(arr);
    }
    if (!back2Arr.length) {
      const b2 = (htmlFlat.match(/เลขท้าย\s*2\s*ตัว[^0-9]+(\d{2})/) || [])[1] || "";
      if (b2) back2Arr = [b2];
    }
    if (!prizeFirstNear.length) {
      const n2 = (htmlFlat.match(/ข้างเคียงรางวัลที่\s*1[^0-9]+((?:\d{6}[^0-9]{0,5}){1,2})/) || [])[1] || "";
      const arr = n2.match(/\d{6}/g);
      if (arr) prizeFirstNear = onlyDigitsArr(arr);
    }
  }

  const result = {
    status: "success",
    response: {
      date: dateTH || "(unknown)",
      endpoint: latestHref,
      prizes: [
        { id: "prizeFirst", name: "รางวัลที่ 1", reward: "6000000", amount: 1, number: prizeFirst ? [prizeFirst] : [] },
        { id: "prizeFirstNear", name: "รางวัลข้างเคียงรางวัลที่ 1", reward: "100000", amount: 2, number: prizeFirstNear }
      ],
      runningNumbers: [
        { id: "runningNumberFrontThree", name: "รางวัลเลขหน้า 3 ตัว", reward: "4000", amount: front3.length, number: front3 },
        { id: "runningNumberBackThree", name: "รางวัลเลขท้าย 3 ตัว", reward: "4000", amount: back3.length, number: back3 },
        { id: "runningNumberBackTwo", name: "รางวัลเลขท้าย 2 ตัว", reward: "2000", amount: back2Arr.length, number: back2Arr }
      ]
    }
  };

  const latestPath = path.join(DATA_DIR, "latest.json");
  const ymdPath = path.join(DATA_DIR, `${ymd}.json`);
  fs.writeFileSync(latestPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(ymdPath, JSON.stringify(result, null, 2));
  console.log("✔️ saved:", latestPath, ymdPath);

  if (!prizeFirst || !front3.length || !back3.length || !back2Arr.length) {
    console.warn("⚠️ Some fields are empty. Check data/raw-*.txt or data/html-*.html to adjust regex.");
  }
})();
