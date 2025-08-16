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

function normNums(txt) {
  return txt.match(/\d{6}|\b\d{3}\b|\b\d{2}\b/g) || [];
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded" });

  // หา link งวดล่าสุด
  const latestHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a"))
      .find(x => /\/lotto\/check\//.test(x.href));
    return a ? a.href : null;
  });
  if (!latestHref) throw new Error("ไม่พบลิงก์งวดล่าสุด");

  await page.goto(latestHref, { waitUntil: "domcontentloaded" });
  const raw = await page.evaluate(() => document.body.innerText);
  await browser.close();

  const mDate = raw.match(/งวดวันที่\s+(\d{1,2}\s+[^\s]+\s+\d{4})/);
  const dateTH = mDate ? mDate[1].trim() : "";
  const ymd = thaiDateToYMD(dateTH);

  // รางวัลที่ 1
  const prizeFirst = (raw.match(/รางวัลที่\s*1[^\d]+(\d{6})/) || [])[1] || "";

  // ข้างเคียงรางวัลที่ 1
  const prizeFirstNear = (raw.match(/ข้างเคียงรางวัลที่\s*1[^0-9]+((?:\d{6}\s+){1,2})/) || [])[1] || "";
  const prizeFirstNearArr = prizeFirstNear.trim().split(/\s+/).filter(Boolean);

  // เลขหน้า/ท้าย
  const front3 = (raw.match(/เลขหน้า\s*3\s*ตัว[^0-9]+((?:\d{3}\s+){1,4})/) || [])[1] || "";
  const back3  = (raw.match(/เลขท้าย\s*3\s*ตัว[^0-9]+((?:\d{3}\s+){1,4})/) || [])[1] || "";
  const back2  = (raw.match(/เลขท้าย\s*2\s*ตัว[^0-9]+(\d{2})/) || [])[1] || "";

  const result = {
    status: "success",
    response: {
      date: dateTH,
      endpoint: latestHref,
      prizes: [
        { id:"prizeFirst", name:"รางวัลที่ 1", reward:"6000000", amount:1, number:[prizeFirst] },
        { id:"prizeFirstNear", name:"รางวัลข้างเคียงรางวัลที่ 1", reward:"100000", amount:2, number:prizeFirstNearArr }
      ],
      runningNumbers: [
        { id:"runningNumberFrontThree", name:"รางวัลเลขหน้า 3 ตัว", reward:"4000", amount:2, number: front3.trim().split(/\s+/).filter(Boolean) },
        { id:"runningNumberBackThree",  name:"รางวัลเลขท้าย 3 ตัว", reward:"4000", amount:2, number: back3.trim().split(/\s+/).filter(Boolean) },
        { id:"runningNumberBackTwo",    name:"รางวัลเลขท้าย 2 ตัว", reward:"2000", amount:1, number: back2 ? [back2] : [] }
      ]
    }
  };

  const text = JSON.stringify(result, null, 2);
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), text);
  fs.writeFileSync(path.join(DATA_DIR, `${ymd}.json`), text);
  console.log("✔️ Scraped and saved", ymd);
})();
