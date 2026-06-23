/**
 * build_books_from_data.js
 * 이미 수집된 알라딘 API 데이터를 books.json으로 변환
 * 알라딘 API를 직접 호출하여 데이터 수집 후 저장
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TTB_KEY = "ttb11dlguswns1147001";
const MAX_RESULTS = 50;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.abort();
      reject(new Error("Request timeout"));
    });
  });
}

function buildUrl(queryType, start) {
  const params = new URLSearchParams({
    TTBKey: TTB_KEY,
    QueryType: queryType,
    MaxResults: String(MAX_RESULTS),
    start: String(start),
    SearchTarget: "Book",
    output: "js",
    Version: "20131101",
    Cover: "Big",
  });
  return `http://www.aladin.co.kr/ttb/api/ItemList.aspx?${params.toString()}`;
}

function extractCategory(categoryName) {
  if (!categoryName) return ["일반"];
  const parts = categoryName.split(">");
  const meaningful = parts.slice(1).filter(Boolean);
  return meaningful.length > 0 ? meaningful : ["일반"];
}

async function fetchQueryType(queryType, start) {
  const url = buildUrl(queryType, start);
  console.log(`[fetch] ${queryType} start=${start}`);
  try {
    const raw = await fetchUrl(url);
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) json = JSON.parse(match[0]);
      else { console.error(`파싱 실패`); return []; }
    }
    if (json.errorCode) {
      console.error(`API 오류 ${json.errorCode}: ${json.errorMessage}`);
      return [];
    }
    const items = json.item || [];
    console.log(`  → ${items.length}권 수신`);
    return items;
  } catch (err) {
    console.error(`오류: ${err.message}`);
    return [];
  }
}

function transformItem(item, index) {
  const isbn = item.isbn13 || item.isbn || "";
  const categoryParts = extractCategory(item.categoryName);
  const reviewRank = parseFloat(item.customerReviewRank || 0);
  return {
    id: String(index + 1),
    title: item.title || "",
    author: item.author || "Unknown",
    authors: item.author ? [item.author] : ["Unknown"],
    genre: categoryParts,
    isbn: isbn,
    cover_url: item.cover || "",
    description: item.description || item.fullDescription || "",
    publisher: item.publisher || "",
    pubDate: item.pubDate || "",
    language: "ko",
    average_rating: Math.round((reviewRank / 2) * 100) / 100,
  };
}

async function main() {
  console.log("=== 알라딘 도서 수집 시작 ===");

  const queries = [
    { queryType: "Bestseller", start: 1 },
    { queryType: "ItemNewAll", start: 1 },
    { queryType: "ItemNewSpecial", start: 1 },
    { queryType: "Bestseller", start: 51 },
    { queryType: "ItemNewAll", start: 51 },
  ];

  const allRaw = [];
  const seenItemId = new Set();
  const seenIsbn = new Set();

  for (const q of queries) {
    const items = await fetchQueryType(q.queryType, q.start);
    for (const item of items) {
      const isbn = item.isbn13 || item.isbn || "";
      const itemId = String(item.itemId || "");
      if (itemId && seenItemId.has(itemId)) continue;
      if (isbn && seenIsbn.has(isbn)) continue;
      if (itemId) seenItemId.add(itemId);
      if (isbn) seenIsbn.add(isbn);
      allRaw.push(item);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[중복 제거 후] 총 ${allRaw.length}권`);

  const books = allRaw.map((item, i) => transformItem(item, i));

  const dataDir = path.join(__dirname, "..", "public", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "books.json");
  fs.writeFileSync(outPath, JSON.stringify(books, null, 2), "utf-8");

  console.log(`\n=== 완료 ===`);
  console.log(`총 도서 수: ${books.length}권`);
  if (books[0]) {
    console.log(`첫 번째: "${books[0].title}" (${books[0].language})`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
