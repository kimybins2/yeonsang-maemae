// 연상매매 주가 API
// GET /api/stock?q=종목명|종목코드[&exact=1][&index=1]
//  - 종목을 찾아 일봉(최근 약 1년)과 월봉(최근 6년)을 돌려줍니다.
//  - index=1 이면 지수(KOSPI, KOSDAQ)로 보고 월봉만 돌려줍니다.
//  - exact=1 이면 이름이 정확히 같은 종목만 인정합니다(자유 입력이 종목명인지 확인할 때).
// 데이터 출처: 네이버 금융 공개 차트/검색 데이터

// 자주 쓰는 종목은 코드를 미리 적어 둬서 검색 없이 바로 찾습니다.
const KNOWN = {
  "하림": ["136480", "코스닥"],
  "삼성전자": ["005930", "코스피"],
  "현대차": ["005380", "코스피"],
  "카카오": ["035720", "코스피"],
  "농심": ["004370", "코스피"],
  "동서": ["026960", "코스피"],
  "하이트진로": ["000080", "코스피"],
  "대한제분": ["001130", "코스피"],
  "덴티움": ["145720", "코스피"],
  "콜마비앤에이치": ["200130", "코스피"],
  "롯데웰푸드": ["280360", "코스피"],
  "LG생활건강": ["051900", "코스피"],
  "농우바이오": ["054050", "코스닥"],
  "신신제약": ["002800", "코스피"],
  "대상": ["001680", "코스피"],
  "아모레퍼시픽": ["090430", "코스피"],
  "깨끗한나라": ["004540", "코스피"],
  "인터로조": ["119610", "코스닥"],
};
const INDEXES = { KOSPI: "코스피", KOSDAQ: "코스닥" };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TTL = 10 * 60 * 1000; // 같은 요청은 10분간 재사용
const memo = new Map();

const norm = (s) => String(s || "").replace(/\s/g, "").toLowerCase();

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" } });
  if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: 502 });
  return await r.text();
}

async function cached(key, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  memo.set(key, { t: Date.now(), v });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return v;
}

// 네이버 자동완성 응답에서 국내 종목 목록을 뽑아냅니다(응답 형식이 바뀌어도 최대한 버티게).
export function parseSearch(text) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  const raw = j?.items ?? j?.result?.items ?? [];
  const list = [];
  const walk = (it) => {
    if (!it) return;
    if (Array.isArray(it)) {
      const flat = it.flat(3).map(String);
      const code = flat.find((s) => /^\d{6}$/.test(s));
      const name = flat.find((s) => s && s !== code && !/^\d+$/.test(s));
      if (code && name) list.push({ code, name, market: "" });
      return;
    }
    if (typeof it === "object") {
      const code = String(it.code ?? it.itemCode ?? it.reutersCode ?? "");
      if (/^\d{6}$/.test(code) && (!it.nationCode || it.nationCode === "KOR")) {
        list.push({ code, name: String(it.name ?? it.stockName ?? code), market: String(it.typeName ?? it.stockExchangeName ?? "") });
      }
    }
  };
  for (const it of raw) {
    // 예전 형식은 items: [[...종목들...]] 처럼 한 번 더 감싸져 있음
    if (Array.isArray(it) && it.length && Array.isArray(it[0]) && Array.isArray(it[0][0])) it.forEach(walk);
    else walk(it);
  }
  return list;
}

async function search(q) {
  const urls = [
    `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`,
    `https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(q)}&target=stock`,
  ];
  for (const u of urls) {
    try {
      const items = parseSearch(await getText(u));
      if (items.length) return items;
    } catch { /* 다음 주소로 */ }
  }
  return [];
}

async function resolve(q, exact) {
  const key = Object.keys(KNOWN).find((k) => norm(k) === norm(q));
  if (key) return { code: KNOWN[key][0], name: key, market: KNOWN[key][1] };
  if (/^\d{6}$/.test(q.trim())) {
    const byCode = Object.entries(KNOWN).find(([, v]) => v[0] === q.trim());
    if (byCode) return { code: byCode[1][0], name: byCode[0], market: byCode[1][1] };
  }
  const items = await cached("s:" + norm(q), () => search(q));
  const same = items.find((it) => norm(it.name) === norm(q) || it.code === q.trim());
  if (same) return same;
  if (exact) return null;
  return items[0] || null;
}

// fchart 응답(XML)의 <item data="날짜|시가|고가|저가|종가|거래량"/> 을 읽습니다.
export function parseSeries(text) {
  const re = /(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text))) {
    const c = Number(m[5]);
    if (c > 0 && !seen.has(m[1])) { seen.add(m[1]); out.push({ d: m[1], c }); }
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

async function series(symbol, timeframe, count) {
  return cached(`c:${symbol}:${timeframe}:${count}`, async () => {
    const t = await getText(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&count=${count}&requestType=0`);
    const s = parseSeries(t);
    if (s.length < 2) throw Object.assign(new Error("empty series"), { status: 502 });
    return s;
  });
}

function send(res, status, body, cache = true) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache && status === 200 ? "public, s-maxage=600, stale-while-revalidate=3600" : "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
  const exact = url.searchParams.get("exact") === "1";
  const isIndex = url.searchParams.get("index") === "1";
  if (!q) return send(res, 400, { error: "bad_request", message: "q가 비어 있어요." });

  try {
    if (isIndex) {
      const sym = q.toUpperCase();
      if (!INDEXES[sym]) return send(res, 400, { error: "bad_request", message: "지원하는 지수는 KOSPI, KOSDAQ이에요." });
      const monthly = await series(sym, "month", 72);
      return send(res, 200, { code: sym, name: INDEXES[sym], market: "지수", monthly });
    }
    const info = await resolve(q, exact);
    if (!info) return send(res, 404, { error: "not_found", message: "이 이름의 상장 종목을 찾지 못했어요." });
    const [daily, monthly] = await Promise.all([series(info.code, "day", 250), series(info.code, "month", 72)]);
    return send(res, 200, { ...info, daily, monthly });
  } catch (e) {
    return send(res, e.status || 500, { error: "upstream", message: "시세를 가져오지 못했어요. 잠시 후 다시 시도해 주세요." }, false);
  }
}
