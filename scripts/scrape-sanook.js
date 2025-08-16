import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const LIST_URL = "https://news.sanook.com/lotto/";
const DATA_DIR = path.join(process.cwd(), "data");
await fs.promises.mkdir(DATA_DIR, { recursive: true });

const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function thaiDateToYMD(dateStr) {
  const m = dateStr.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4})/);
  if (!m) return null;
  const d = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(TH_MONTHS.indexOf(m[2]) + 1).padStart(2, "0");
  const yearBE = parseInt(m[3], 10);
  const year = yearBE - 543;
  return `${year}${mm}${d}`;
}

// helper: ตัดช่องว่างซ้ำ/ขึ้นบรรทัดให้อยู่ในรูปแบบง่ายต่อ regex
function squash(s) {
  return s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "").replace(/\n{2,}/g, "\n");
}
function onlyDigitsArr(arr){ return (arr || []).map(x => x.trim()).filter(Boolean); }

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0" });
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded" });

  // หา link งวดล่าสุดแบบชัวร์ขึ้น: เลือก a ที่ href มี /lotto/check/
  const latestHref = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll("a[href*='/lotto/check/']"));
    // เอาตัวแรกสุดบนหน้า
    return as.length ? new URL(as[0].getAttribute("href"), location.href).href : null;
  });
  if (!latestHref) throw new Error("ไม่พบลิงก์งวดล่าสุด");

  await page.goto(latestHref, { waitUntil: "networkidle" });
  await page.waitForTimeout(800); // เผื่อโหลดช้า

  const rawText = await page.evaluate(() => document.body.innerText || "");
  const html = await page.content();
  await browser.close();

  // เก็บดีบักเสมอ
  const textFlat = squash(rawText);
  const dateTH =
    (textFlat.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    (textFlat.match(/ประจำงวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    "";
  const ymd = thaiDateToYMD(dateTH) || "00000000";

  fs.writeFileSync(path.join(DATA_DIR, `raw-${ymd}.txt`), textFlat);
  fs.writeFileSync(path.join(DATA_DIR, `html-${ymd}.html`), html);

  // ---- ดึงเลขแบบทนถึก (ลองหลาย pattern) ----
  // รางวัลที่ 1
  let prizeFirst =
    (textFlat.match(/รางวัลที่\s*1[^\d]+(\d{6})/) || [])[1] ||
    (textFlat.match(/รางวัลที่หนึ่ง[^\d]+(\d{6})/) || [])[1] ||
    "";

  // ข้างเคียงรางวัลที่ 1
  // จับตัวเลข 6 หลัก 1–2 ตัว หลังคำว่า ข้างเคียงรางวัลที่ 1
  let nearBlock =
    (textFlat.match(/ข้างเคียงรางวัลที่\s*1[^0-9]+((?:\d{6}[^\d]{0,5}){1,2})/) || [])[1] || "";
  let prizeFirstNear = onlyDigitsArr(nearBlock.match(/\d{6}/g));

  // หน้า 3 ตัว
  let frontBlock =
    (textFlat.match(/เลขหน้า\s*3\s*ตัว[^0-9]+((?:\d{3}[^\d]{0,3}){1,4})/) || [])[1] || "";
  let front3 = onlyDigitsArr(frontBlock.match(/\b\d{3}\b/g));

  // ท้าย 3 ตัว
  let back3Block =
    (textFlat.match(/เลขท้าย\s*3\s*ตัว[^0-9]+((?:\d{3}[^\d]{0,3}){1,4})/) || [])[1] || "";
  let back3 = onlyDigitsArr(back3Block.match(/\b\d{3}\b/g));

  // ท้าย 2 ตัว
  let back2 = (textFlat.match(/เลขท้าย\s*2\s*ตัว[^0-9]+(\d{2})/) || [])[1] || "";
  let back2Arr = back2 ? [back2] : [];

  // ถ้ายังว่างมาก ให้ลองจาก HTML อีกชุด (บางที innerText หายรูปแบบ)
  if (!prizeFirst) {
    const htmlFlat = squash(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    prizeFirst = (htmlFlat.match(/รางวัลที่\s*1[^\d]+(\d{6})/) || [])[1] || "";
    if (!front3.length) front3 = onlyDigitsArr((htmlFlat.match(/เลขหน้า\s*3\s*ตัว[^0-9]+((?:\d{3}[^0-9]{0,5}){1,4})/) || [])[1]?.match(/\b\d{3}\b/g));
    if (!back3.length)  back3  = onlyDigitsArr((htmlFlat.match(/เลขท้าย\s*3\s*ตัว[^0-9]+((?:\d{3}[^0-9]{0,5}){1,4})/) || [])[1]?.match(/\b\d{3}\b/g));
    if (!back2Arr.length) {
      const b2 = (htmlFlat.match(/เลขท้าย\s*2\s*ตัว[^0-9]+(\d{2})/) || [])[1] || "";
      back2Arr = b2 ? [b2] : [];
    }
    if (!prizeFirstNear.length) {
      const n2 = (htmlFlat.match(/ข้างเคียงรางวัลที่\s*1[^0-9]+((?:\d{6}[^0-9]{0,5}){1,2})/) || [])[1] || "";
      prizeFirstNear = onl
