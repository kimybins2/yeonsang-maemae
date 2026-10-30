// 연상매매 주가 API
// GET /api/stock?q=종목명|종목코드[&exact=1][&index=1]
//  - 종목을 찾아 일봉(최근 약 1년)과 월봉(최근 6년)을 돌려줍니다.
//  - index=1 이면 지수(KOSPI, KOSDAQ)로 보고 월봉만 돌려줍니다.
//  - exact=1 이면 이름이 정확히 같은 종목만 인정합니다(자유 입력이 종목명인지 확인할 때).
// 데이터 출처: 네이버 금융 공개 차트/검색 데이터

// 자주 쓰는 종목은 코드를 미리 적어 둬서 검색 없이 바로 찾습니다.
// 혹시 코드가 틀려도, 네이버 차트에 적힌 실제 회사 이름과 비교해서 다르면 검색으로 다시 찾습니다.
const KNOWN = Object.fromEntries(`
하림:136480 마니커:027740 삼성전자:005930 SK하이닉스:000660 현대차:005380 기아:000270 카카오:035720 NAVER:035420
농심:004370 삼양식품:003230 오뚜기:007310 동서:026960 하이트진로:000080 롯데칠성:005300 무학:033920 국순당:043650
대한제분:001130 오리온:271560 롯데웰푸드:280360 빙그레:005180 매일유업:267980 남양유업:003920 대상:001680 CJ제일제당:097950
풀무원:017810 동원산업:006040 대한제당:001790 삼양사:145990 농우바이오:054050 쿠쿠홈시스:284740 BGF리테일:282330 GS리테일:007070
이마트:139480 롯데쇼핑:023530 현대백화점:069960 신세계:004170 CJ대한통운:000120 한진:002320 깨끗한나라:004540 LG생활건강:051900
아모레퍼시픽:090430 코스맥스:192820 한국콜마:161890 클래시스:214150 파마리서치:214450 신신제약:002800 콜마비앤에이치:200130 덴티움:145720
인터로조:119610 삼성바이오로직스:207940 셀트리온:068270 LG전자:066570 코웨이:021240 위닉스:044340 에이스침대:003800 한샘:009240
한국타이어앤테크놀로지:161390 넥센타이어:002350 영원무역:111770 F&F:383220 휠라홀딩스:081660 메가스터디교육:215200 대교:019680 모나미:005360
HD현대중공업:329180 한화솔루션:009830 씨에스윈드:112610 S-Oil:010950 SK이노베이션:096770 삼천리자전거:024950 엔씨소프트:036570 넷마블:251270
크래프톤:259960 키움증권:039490 미래에셋증권:006800 강원랜드:035250 파라다이스:034230 KB금융:105560 신한지주:055550 카카오뱅크:323410
삼성화재:000810 삼성생명:032830 현대건설:000720 대우건설:047040 고려아연:010130 포스코홀딩스:005490 SK텔레콤:017670 KT:030200
LG유플러스:032640 삼성SDI:006400 LG에너지솔루션:373220 한국전력:015760 한국가스공사:036460 하나투어:039130 모두투어:080160 대한항공:003490
제주항공:089590 진에어:272450 호텔신라:008770 롯데렌탈:089860 쏘카:403550 CJ_CGV:079160 대원미디어:048910 하이브:352820
JYP_Ent.:035900 에스엠:041510 와이지엔터테인먼트:122870 골프존:121440 손오공:066910 삼익악기:002450
`.trim().split(/\s+/).map((p) => { const i = p.lastIndexOf(":"); return [p.slice(0, i).replace(/_/g, " "), p.slice(i + 1)]; }));
const INDEXES = { KOSPI: "코스피", KOSDAQ: "코스닥" };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TTL = 10 * 60 * 1000; // 같은 요청은 10분간 재사용
const memo = new Map();

const norm = (s) => String(s || "").replace(/\s/g, "").toLowerCase();

async function getText(url, encoding) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" } });
  if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: 502 });
  if (!encoding || typeof r.arrayBuffer !== "function") return await r.text();
  const buf = await r.arrayBuffer();
  try { return new TextDecoder(encoding).decode(buf); } catch { return new TextDecoder().decode(buf); }
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

async function searchResolve(q, exact) {
  const items = await cached("s:" + norm(q), () => search(q));
  const same = items.find((it) => norm(it.name) === norm(q) || it.code === q.trim());
  if (same) return same;
  if (exact) return null;
  return items[0] || null;
}

function knownResolve(q) {
  const key = Object.keys(KNOWN).find((k) => norm(k) === norm(q));
  if (key) return { code: KNOWN[key], name: key, market: "", known: true };
  const byCode = Object.entries(KNOWN).find(([, c]) => c === q.trim());
  if (byCode) return { code: byCode[1], name: byCode[0], market: "", known: true };
  return null;
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
export function parseChartName(text) {
  const m = text.match(/<chartdata[^>]*\bname="([^"]*)"/);
  return m ? m[1].trim() : "";
}

async function series(symbol, timeframe, count) {
  return cached(`c:${symbol}:${timeframe}:${count}`, async () => {
    const t = await getText(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&count=${count}&requestType=0`, "euc-kr");
    const s = parseSeries(t);
    if (s.length < 2) throw Object.assign(new Error("empty series"), { status: 502 });
    return { s, name: parseChartName(t) };
  });
}

async function load(info) {
  const [day, month] = await Promise.all([series(info.code, "day", 250), series(info.code, "month", 72)]);
  return { day, month };
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
      const { s } = await series(sym, "month", 72);
      return send(res, 200, { code: sym, name: INDEXES[sym], market: "지수", monthly: s });
    }
    let info = knownResolve(q) || await searchResolve(q, exact);
    if (!info) return send(res, 404, { error: "not_found", message: "이 이름의 상장 종목을 찾지 못했어요." });
    let data = await load(info);
    const realName = data.day.name || data.month.name;
    // 미리 적어 둔 코드가 다른 회사를 가리키면 검색으로 다시 찾기
    if (info.known && realName && norm(realName) !== norm(info.name)) {
      const again = await searchResolve(info.name, true).catch(() => null);
      if (again && again.code !== info.code) { info = again; data = await load(info); }
    }
    return send(res, 200, { code: info.code, name: info.name, market: info.market || "", daily: data.day.s, monthly: data.month.s });
  } catch (e) {
    return send(res, e.status || 500, { error: "upstream", message: "시세를 가져오지 못했어요. 잠시 후 다시 시도해 주세요." }, false);
  }
}
