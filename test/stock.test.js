// 네이버 응답을 흉내 낸 가짜 데이터로 /api/stock 이 제대로 동작하는지 확인합니다.
// 실행: npm test
import assert from "node:assert/strict";
import handler, { parseSeries, parseSearch } from "../api/stock.js";

function fakeXml(n, start = 10000) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(2021, 0, 1 + i * 30);
    const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const c = start + i * 100;
    items.push(`<item data="${ds}|${c}|${c + 50}|${c - 50}|${c}|12345" />`);
  }
  return `<?xml version="1.0" encoding="EUC-KR" ?><protocol><chartdata symbol="X">${items.join("")}</chartdata></protocol>`;
}

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  const ok = (body) => ({ ok: true, status: 200, text: async () => body });
  if (url.includes("fchart")) return ok(fakeXml(url.includes("timeframe=day") ? 250 : 60));
  if (url.includes("ac.stock.naver.com")) {
    if (url.includes(encodeURIComponent("장마"))) return ok(JSON.stringify({ items: [] }));
    return ok(JSON.stringify({ items: [{ code: "035420", name: "NAVER", typeName: "코스피", nationCode: "KOR" }] }));
  }
  if (url.includes("m.stock.naver.com")) return ok(JSON.stringify({ result: { items: [] } }));
  return { ok: false, status: 404, text: async () => "" };
};

function call(path) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k] = v; },
      end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); },
    };
    handler({ url: path }, res);
  });
}

// 파서
assert.equal(parseSeries(fakeXml(3)).length, 3);
assert.deepEqual(parseSeries(fakeXml(1))[0], { d: "20210101", c: 10000 });
assert.equal(parseSearch(JSON.stringify({ items: [[[["NAVER"], ["035420"]]]] }))[0].code, "035420");
assert.equal(parseSearch(JSON.stringify({ result: { items: [{ code: "005930", name: "삼성전자", nationCode: "KOR" }] } }))[0].name, "삼성전자");

// 차트 이름 읽기
assert.equal((await import("../api/stock.js")).parseChartName('<chartdata symbol="005930" name="삼성전자" count="2">'), "삼성전자");

// 미리 아는 종목은 검색 없이 바로
let r = await call("/api/stock?q=" + encodeURIComponent("하림"));
assert.equal(r.status, 200);
assert.equal(r.body.code, "136480");
assert.equal(r.body.daily.length, 250);
assert.equal(r.body.monthly.length, 60);
assert.ok(!calls.some((u) => u.includes("ac.stock")), "하림은 검색을 안 해야 함");
assert.match(r.headers["Cache-Control"], /s-maxage/);

// 모르는 종목은 검색으로
r = await call("/api/stock?q=NAVER");
assert.equal(r.status, 200);
assert.equal(r.body.code, "035420");

// 정확히 일치해야 할 때 아닌 건 404
r = await call("/api/stock?q=" + encodeURIComponent("네이버주식좋아") + "&exact=1");
assert.equal(r.status, 404);
r = await call("/api/stock?q=" + encodeURIComponent("장마 시작") + "&exact=1");
assert.equal(r.status, 404);

// 지수
r = await call("/api/stock?q=KOSPI&index=1");
assert.equal(r.status, 200);
assert.equal(r.body.name, "코스피");
assert.equal(r.body.monthly.length, 60);

// 빈 입력
r = await call("/api/stock?q=");
assert.equal(r.status, 400);

console.log("모든 테스트 통과");
