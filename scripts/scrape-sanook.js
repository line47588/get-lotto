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

function cleanLine(s) {
  return (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}
function digitsIn(line, pattern) {
  // คืน array ตัวเลขที่ตรงกับ pattern (เช่น 6 หลัก / 3 หลัก / 2 หลัก)
  const re = new RegExp(pattern, "g");
  return (line.match(re) || []);
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: "Mozilla/5.0" });

  // 1) หา URL งวดล่าสุด
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded" });
  const latestHref = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll("a[href*='/lotto/check/']"));
    return as.length ? new URL(as[0].getAttribute("href"), location.href).href : null;
  });
  if (!latestHref) {
    await browser.close();
    throw new Error("ไม่พบลิงก์งวดล่าสุดจากหน้า list");
  }

  // 2) เข้าไปหน้า “ตรวจหวยงวดนี้”
  await page.goto(latestHref, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // ดึงข้อความทุกบรรทัดจากบทความ (เฉพาะส่วนเนื้อหา)
  const articleText = await page.evaluate(() => {
    // กว้าง ๆ: ลองหาคอนเทนเนอร์บทความ ถ้าไม่เจอ ใช้ทั้ง body
    const root =
      document.querySelector("article") ||
      document.querySelector("[class*='content']") ||
      document.body;
    return root.innerText;
  });

  await browser.close();

  const raw = articleText || "";
  const lines = raw.split("\n").map(cleanLine).filter(Boolean);

  // เขียนไฟล์ debug เผื่อดู pattern ถัดไป
  const flat = lines.join("\n");
  let dateTH =
    (flat.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    (flat.match(/ประจำงวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] || "";
  const ymd = thaiDateToYMD(dateTH) || "00000000";
  fs.writeFileSync(path.join(DATA_DIR, `raw-${ymd}.txt`), flat);

  // 3) เดินบรรทัดแบบ state machine: เจอหัวข้อ -> เก็บตัวเลขจากบรรทัดถัด ๆ ไป
  const state = { section: null };
  const result = {
    first: "",
    near: [],
    front3: [],
    back3: [],
    back2: []
  };

  const isHeader = (line, key) => new RegExp(key).test(line);

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    if (isHeader(L, /งวดวันที่/)) {
      const m = L.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/);
      if (m) dateTH = m[1];
      state.section = null;
      continue;
    }

    if (isHeader(L, /รางวัลที่\s*1\b|รางวัลที่หนึ่ง/)) { state.section = "first"; continue; }
    if (isHeader(L, /เลขหน้า\s*3\s*ตัว/))               { state.section = "front3"; continue; }
    if (isHeader(L, /เลขท้าย\s*3\s*ตัว/))               { state.section = "back3"; continue; }
    if (isHeader(L, /เลขท้าย\s*2\s*ตัว/))               { state.section = "back2"; continue; }
    if (isHeader(L, /ข้างเคียงรางวัลที่\s*1/))          { state.section = "near";   continue; }

    // ถ้าอยู่ใน section ให้เก็บตัวเลขของบรรทัดนี้
    if (state.section === "first" && !result.first) {
      const nums = digitsIn(L, /\b\d{6}\b/);
      if (nums.length) result.first = nums[0];
      continue;
    }
    if (state.section === "front3" && result.front3.length < 4) {
      const nums = digitsIn(L, /\b\d{3}\b/);
      if (nums.length) result.front3.push(...nums);
      continue;
    }
    if (state.section === "back3" && result.back3.length < 4) {
      const nums = digitsIn(L, /\b\d{3}\b/);
      if (nums.length) result.back3.push(...nums);
      continue;
    }
    if (state.section === "back2" && result.back2.length < 1) {
      const nums = digitsIn(L, /\b\d{2}\b/);
      if (nums.length) result.back2.push(nums[0]);
      continue;
    }
    if (state.section === "near" && result.near.length < 2) {
      const nums = digitsIn(L, /\b\d{6}\b/);
      if (nums.length) result.near.push(...nums);
      continue;
    }
  }

  // 4) จัด JSON ให้เข้ากับ schema เดิม
  const output = {
    status: "success",
    response: {
      date: dateTH || "(unknown)",
      endpoint: latestHref,
      prizes: [
        { id: "prizeFirst",     name: "รางวัลที่ 1",                reward: "6000000", amount: 1,   number: result.first ? [result.first] : [] },
        { id: "prizeFirstNear", name: "รางวัลข้างเคียงรางวัลที่ 1", reward: "100000",  amount: 2,   number: result.near }
      ],
      runningNumbers: [
        { id: "runningNumberFrontThree", name: "รางวัลเลขหน้า 3 ตัว", reward: "4000", amount: result.front3.length, number: result.front3 },
        { id: "runningNumberBackThree",  name: "รางวัลเลขท้าย 3 ตัว",  reward: "4000", amount: result.back3.length,  number: result.back3 },
        { id: "runningNumberBackTwo",    name: "รางวัลเลขท้าย 2 ตัว",  reward: "2000", amount: result.back2.length,  number: result.back2 }
      ]
    }
  };

  const latestPath = path.join(DATA_DIR, "latest.json");
  const datedPath  = path.join(DATA_DIR, `${ymd}.json`);
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(datedPath, JSON.stringify(output, null, 2));
  console.log("✔️ saved:", latestPath, datedPath);

  // แจ้งเตือนถ้ายังว่าง จะได้เปิด raw-*.txt มาดูหน้าจริง
  if (!result.first || !result.front3.length || !result.back3.length || !result.back2.length) {
    console.warn("⚠️ ยังมีฟิลด์ว่าง: เปิด data/raw-%s.txt เพื่อตรวจรูปแบบบรรทัด", ymd);
  }
})();
