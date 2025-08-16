import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const LIST_URL = "https://news.sanook.com/lotto/";
const DATA_DIR = path.join(process.cwd(), "data");
await fs.promises.mkdir(DATA_DIR, { recursive: true });

const TH_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

function thaiDateToYMD(dateStr) {
  const m = dateStr?.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4})/);
  if (!m) return null;
  const d = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(TH_MONTHS.indexOf(m[2]) + 1).padStart(2, "0");
  const yearBE = parseInt(m[3], 10);
  const year = yearBE - 543;
  return `${year}${mm}${d}`;
}
const clean = s =>
  (s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "").trim();

function digitsIn(line, rx) {
  const m = line.match(rx);
  return m ? m : [];
}

async function getLatestCheckUrl() {
  const res = await fetch(LIST_URL, { headers: { "User-Agent": "curl/8" }});
  if (!res.ok) throw new Error(`GET list ${res.status}`);
  const html = await res.text();
  // หา /lotto/check/xxxxxx/ จากหน้า list
  const m = html.match(/href="(\/lotto\/check\/\d+\/?)"/);
  if (!m) throw new Error("ไม่พบลิงก์งวดล่าสุดจากหน้า list");
  return new URL(m[1], LIST_URL).href;
}

async function getArticleText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "curl/8" }});
  if (!res.ok) throw new Error(`GET article ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const root = $("article").text() || $("[class*='content']").text() || $("body").text();
  // รวมเป็นบรรทัด ๆ
  return root.split("\n").map(clean).filter(Boolean);
}

(async () => {
  const latestHref = await getLatestCheckUrl();
  const lines = await getArticleText(latestHref);
  const flat = lines.join("\n");

  // วันที่ไทย
  let dateTH =
    (flat.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] ||
    (flat.match(/ประจำงวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/) || [])[1] || "";
  const ymd = thaiDateToYMD(dateTH) || "00000000";

  // debug raw text เผื่ออยากเปิดดู
  fs.writeFileSync(path.join(DATA_DIR, `raw-${ymd}.txt`), flat);

  // เดินบรรทัดแบบ state machine
  const state = { section: null };
  const result = { first: "", near: [], front3: [], back3: [], back2: [] };
  const isHeader = (line, re) => re.test(line);

  for (const Lraw of lines) {
    const L = Lraw;

    if (isHeader(L, /งวดวันที่/)) {
      const m = L.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/);
      if (m) dateTH = m[1];
      state.section = null;
      continue;
    }
    if (isHeader(L, /รางวัลที่\s*1\b|รางวัลที่หนึ่ง/)) { state.section = "first";  continue; }
    if (isHeader(L, /ข้างเคียงรางวัลที่\s*1/))          { state.section = "near";   continue; }
    if (isHeader(L, /เลขหน้า\s*3\s*ตัว/))               { state.section = "front3"; continue; }
    if (isHeader(L, /เลขท้าย\s*3\s*ตัว/))               { state.section = "back3";  continue; }
    if (isHeader(L, /เลขท้าย\s*2\s*ตัว/))               { state.section = "back2";  continue; }

    if (state.section === "first" && !result.first) {
      const n = digitsIn(L, /\b\d{6}\b/g);
      if (n.length) result.first = n[0];
      continue;
    }
    if (state.section === "near" && result.near.length < 2) {
      const n = digitsIn(L, /\b\d{6}\b/g);
      if (n.length) result.near.push(...n);
      continue;
    }
    if (state.section === "front3" && result.front3.length < 4) {
      const n = digitsIn(L, /\b\d{3}\b/g);
      if (n.length) result.front3.push(...n);
      continue;
    }
    if (state.section === "back3" && result.back3.length < 4) {
      const n = digitsIn(L, /\b\d{3}\b/g);
      if (n.length) result.back3.push(...n);
      continue;
    }
    if (state.section === "back2" && result.back2.length < 1) {
      const n = digitsIn(L, /\b\d{2}\b/g);
      if (n.length) result.back2.push(n[0]);
      continue;
    }
  }

  // สร้าง JSON ตาม schema เดิม + timestamp เพื่อให้มี diff
  const output = {
    status: "success",
    response: {
      date: dateTH || "(unknown)",
      endpoint: latestHref,
      prizes: [
        { id: "prizeFirst",     name: "รางวัลที่ 1",                reward: "6000000", amount: 1, number: result.first ? [result.first] : [] },
        { id: "prizeFirstNear", name: "รางวัลข้างเคียงรางวัลที่ 1", reward: "100000",  amount: 2, number: result.near }
      ],
      runningNumbers: [
        { id: "runningNumberFrontThree", name: "รางวัลเลขหน้า 3 ตัว", reward: "4000", amount: result.front3.length, number: result.front3 },
        { id: "runningNumberBackThree",  name: "รางวัลเลขท้าย 3 ตัว",  reward: "4000", amount: result.back3.length,  number: result.back3 },
        { id: "runningNumberBackTwo",    name: "รางวัลเลขท้าย 2 ตัว",  reward: "2000", amount: result.back2.length,  number: result.back2 }
      ]
    },
    scraped_at: new Date().toISOString()
  };

  const latestPath = path.join(DATA_DIR, "latest.json");
  const datedPath  = path.join(DATA_DIR, `${ymd}.json`);
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(datedPath, JSON.stringify(output, null, 2));

  console.log("Parsed -> first:", result.first,
    "| near:", JSON.stringify(result.near),
    "| front3:", JSON.stringify(result.front3),
    "| back3:", JSON.stringify(result.back3),
    "| back2:", JSON.stringify(result.back2));
  console.log("✔️ saved:", latestPath, datedPath);
})();
