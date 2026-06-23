/**
 * fetch_aladin.js
 * 알라딘 Open API에서 한국 도서 200권+ 수집 후 public/data/books.json 저장
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TTB_KEY = "ttb11dlguswns1147001";
const MAX_RESULTS = 50;
// Recommend는 유효하지 않은 QueryType → Bestseller, ItemNewAll, ItemNewSpecial + Bestseller 2페이지로 200권+
const QUERY_TYPES = [
  { QueryType: "Bestseller", start: 1 },
  { QueryType: "Bestseller", start: 51 },
  { QueryType: "Bestseller", start: 101 },
  { QueryType: "ItemNewAll", start: 1 },
  { QueryType: "ItemNewSpecial", start: 1 },
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
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
  return `https://www.aladin.co.kr/ttb/api/ItemList.aspx?${params.toString()}`;
}

function extractCategory(categoryName) {
  if (!categoryName) return ["일반"];
  // "국내도서>소설/시/희곡>한국소설>현대소설" → 마지막 부분 분리
  const parts = categoryName.split(">");
  // 마지막 의미 있는 부분들 반환 (최대 2개)
  const meaningful = parts.slice(1).filter(Boolean);
  return meaningful.length > 0 ? meaningful : ["일반"];
}

async function fetchQueryType(queryType, start) {
  const url = buildUrl(queryType, start);
  console.log(`[fetch] QueryType=${queryType} start=${start} → ${url}`);
  try {
    const raw = await fetchUrl(url);

    // 응답이 JSON인지 확인 (output=js 는 순수 JSON 반환)
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      // JSONP 래퍼가 있을 경우 제거 시도
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        json = JSON.parse(match[0]);
      } else {
        console.error(`[fetch] ${queryType} start=${start}: 파싱 실패 - 원시 응답 첫 200자:`, raw.slice(0, 200));
        return [];
      }
    }

    // 오류 응답 확인
    if (json.errorCode) {
      console.error(`[fetch] ${queryType} start=${start}: API 오류 ${json.errorCode}: ${json.errorMessage}`);
      return [];
    }

    const items = json.item || [];
    console.log(`[fetch] ${queryType} start=${start}: ${items.length}권 수신`);
    return items;
  } catch (err) {
    console.error(`[fetch] ${queryType} start=${start} 오류:`, err.message);
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

  const allItems = [];
  const seenIsbn = new Set();
  const seenItemId = new Set();

  for (const { QueryType, start } of QUERY_TYPES) {
    const items = await fetchQueryType(QueryType, start);
    for (const item of items) {
      const isbn = item.isbn13 || item.isbn || "";
      const itemId = String(item.itemId || "");

      // 중복 제거: ISBN 또는 itemId 기준
      if (isbn && seenIsbn.has(isbn)) continue;
      if (itemId && seenItemId.has(itemId)) continue;

      if (isbn) seenIsbn.add(isbn);
      if (itemId) seenItemId.add(itemId);

      allItems.push(item);
    }

    // API 요청 간 약간의 대기 (예의 바른 크롤링)
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n[중복 제거 후] 총 ${allItems.length}권`);

  // 변환
  const books = allItems.map((item, i) => transformItem(item, i));

  // 저장
  const dataDir = path.join(__dirname, "..", "public", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "books.json");
  fs.writeFileSync(outPath, JSON.stringify(books, null, 2), "utf-8");

  console.log(`\n=== 완료 ===`);
  console.log(`저장 경로: ${outPath}`);
  console.log(`총 도서 수: ${books.length}권`);
  if (books[0]) {
    console.log(`첫 번째 도서: "${books[0].title}" (${books[0].language})`);
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
