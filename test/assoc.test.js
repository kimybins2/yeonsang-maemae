// 연상 지도 점검: 끊긴 연결이 없는지, 결과가 충분히 다양한지
// 실행: npm test
import assert from "node:assert/strict";
import "../assoc.js";
const { N, BRIDGES, DIST, walk, findStart, size } = globalThis.YS_ASSOC;

// 1. 모든 연결 대상이 존재하고, 모든 단어가 끝점에 닿을 수 있어야 함
for (const [k, v] of Object.entries(N)) {
  for (const [to, why] of v.e || []) {
    assert.ok(N[to], `${k} → ${to}: 없는 단어`);
    assert.ok(why && why.length <= 20, `${k} → ${to}: 이유가 비었거나 너무 김`);
  }
  assert.ok(Number.isFinite(DIST[k]), `${k}: 끝점에 닿을 길이 없음`);
  if (v.t) assert.ok(v.t[0].endsWith("관련주") && v.t[1].length, `${k}: 끝점 형식 오류`);
}
for (const [b] of BRIDGES) assert.ok(N[b], `다리 ${b} 없음`);

// 2. 입력 매칭
assert.equal(findStart("치킨 먹고 싶다").key, "닭");
assert.equal(findStart("월요병").key, "야근");
assert.equal(findStart("첫눈 왔다").key, "첫눈");
assert.equal(findStart("휴대폰 바꿈").key, "휴대폰");
assert.equal(findStart("콘서트 티켓팅").key, "아이돌 앨범");
assert.equal(findStart("아무말대잔치"), null);

// 3. 많은 입력으로 돌려 보기
const inputs = ["월요병","비 오는 날","치킨","로또 당첨","여자친구 생김","야근","월급날","눈 옴","시험 망함","강아지 입양","감기 걸림","다이어트 시작","부장님 잔소리","아이폰 신작","전세 계약","커피 끊기","주식 물림","제주도 여행","새벽 3시","콘서트 티켓팅","헬스 등록","택배 왔다","가을 단풍","아무말대잔치","외계인 등장","우리집 고양이","라면 끓임","숙취 지옥","소개팅 망함","보일러 고장"];
const sectors = new Set(), picks = new Set(), firstHops = new Set();
for (const q of inputs) {
  for (let v = 0; v < 3; v++) {
    const r = walk(q, v);
    assert.equal(r.steps[0][0], q);
    assert.ok(r.steps.length >= 3 && r.steps.length <= 9, `${q}: 단계 수 ${r.steps.length}`);
    assert.ok(N[r.steps[r.steps.length - 1][0]].t, `${q}: 끝점이 아님`);
    assert.ok(r.pick, `${q}: 종목 없음`);
    assert.ok(!/\{/.test(r.comment), `${q}: 코멘트 치환 누락`);
    const labels = r.steps.slice(1).map(s => s[0]);
    assert.equal(new Set(labels).size, labels.length, `${q}: 같은 단어 반복`);
    sectors.add(r.sector); picks.add(r.pick); firstHops.add(r.steps[1][0]);
    if (v === 0) console.log(`${q} → ${r.steps.slice(1).map(s => s[0]).join(" → ")} ⇒ ${r.sector} (${r.pick})`);
  }
}
// 같은 입력 같은 결과, variant가 다르면 대체로 다른 결과
assert.deepEqual(walk("야근", 0), walk("야근", 0));
let diff = 0; for (const q of inputs) if (walk(q, 0).pick !== walk(q, 1).pick || walk(q,0).steps.length !== walk(q,1).steps.length) diff++;
assert.ok(diff >= inputs.length * 0.6, `다시 돌려도 결과가 너무 비슷함 (${diff}/${inputs.length})`);
// 정석 종목과 겹치지 않게
for (let v = 0; v < 5; v++) assert.notEqual(walk("치킨", v, "하림").pick, "하림");

console.log(`\n단어 ${size}개 · 업종 ${sectors.size}종 · 종목 ${picks.size}개 · 첫 연결 ${firstHops.size}가지`);
console.log("연상 지도 테스트 통과");
