// 핵심 엔진 단위 테스트 — 실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { sha256, won, sundayOf, addDays, monthEnd, parseYmd, maskRrn } from '../core/util.js';
import { parseKoreanAmount, parseOfferings, parseExpenses, classifyExpense, parseTable } from '../core/parse.js';
import { createDoc, addTx, updateTx, deleteTx, lockPeriod, verifyAudit, upsertMember, fyOf, fyRange, setBudget, setOpening, mergeDocs, upsertBatch, liveTxs } from '../core/ledger.js';
import { summarize, periodRange, donorTotals, issueReceipt, openingOf, balanceAt } from '../core/reports.js';
import { parseBridge, setupPrompt } from '../core/bridge.js';
import { createKeyring, unlockKeyring, encryptJson, decryptJson, rewrapPassword, genRecoveryCode, checkPassword, encryptBytes, decryptBytes } from '../core/crypto.js';
import { makeZip, makeXlsx, toCsv, crc32 } from '../core/zip.js';
import { koreanAmountText, financeReportHtml, voucherHtml, receiptHtml } from '../core/render.js';

const sampleDoc = () => {
  const d = createDoc({ churchName: '새빛교회' });
  upsertMember(d, { no: 1, name: '김철수', weekly: 20000, rrn: '9001011234567', address: '서울' });
  upsertMember(d, { no: 2, name: '이영희', weekly: 15000 });
  upsertMember(d, { no: 3, name: '박민수', weekly: 10000 });
  return d;
};

test('SHA-256 동기 구현이 Node crypto와 일치', () => {
  for (const s of ['', 'abc', '교회 재정 ✝', 'x'.repeat(1000)]) assert.equal(sha256(s), createHash('sha256').update(s).digest('hex'));
});

test('날짜·금액 유틸', () => {
  assert.equal(won(1234567), '1,234,567');
  assert.equal(won(-1200000), '-1,200,000');
  assert.equal(sundayOf('2026-11-11'), '2026-11-08');
  assert.equal(sundayOf('2026-11-08'), '2026-11-08');
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(parseYmd('2026-02-30'), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(maskRrn('9001011234567'), '900101-1******');
});

test('한국어 금액 해석', () => {
  const cases = { '10만': 100000, '10만5천원': 105000, '삼십이만 사천': 324000, '1,234,500원': 1234500, '1.5만': 15000, '십만원': 100000, '만원': 10000, '천원': 1000, '일금 십만원정': 100000, '1억2천만': 120000000, '이영': null, '십일조': null };
  for (const [k, v] of Object.entries(cases)) assert.equal(parseKoreanAmount(k), v, k);
});

test('헌금 문장 파싱: 여러 건·교인번호·주정 자동·부부·붙여쓰기', () => {
  const d = sampleDoc();
  const P = (t, def = '101') => parseOfferings(t, { accounts: d.accounts, members: d.members, defaultAccountId: def });
  let r = P('십일조 김철수 10만원, 감사 이영희 5만');
  assert.deepEqual(r.map((x) => [x.accountId, x.donor, x.amount]), [['102', '김철수', 100000], ['103', '이영희', 50000]]);
  r = P('십일조 김철수 10만 원 감사헌금 이영희 5만 원 선교 박민수 3만 원');
  assert.equal(r.length, 3); assert.equal(r[2].accountId, '104'); assert.equal(r[2].amount, 30000);
  r = P('1\n2\n3');
  assert.deepEqual(r.map((x) => x.amount), [20000, 15000, 10000]);
  assert.ok(r.every((x) => x.auto === '주정'));
  r = P('김철수 이영희 부부 감사 10만원');
  assert.equal(r[0].donor2, '이영희'); assert.equal(r[0].warnings.length, 0);
  r = P('김철수십일조 100,000');
  assert.equal(r[0].accountId, '102'); assert.equal(r[0].memberId, d.members[0].id);
  r = P('김철수 집사 십일조 이십만원 계좌이체');
  assert.equal(r.length, 1); assert.equal(r[0].method, '계좌'); assert.equal(r[0].amount, 200000);
  r = P('12 십일조 10만');
  assert.ok(r[0].warnings.some((w) => w.includes('교인번호 12')));
  r = P('2번 감사 3만원');
  assert.equal(r[0].donor, '이영희');
  r = P('무명 주일헌금 32만 4천원');
  assert.equal(r[0].donor, '무명'); assert.equal(r[0].amount, 324000);
});

test('지출 파싱·자동분류(키워드+과거 학습)', () => {
  const d = sampleDoc();
  const r = parseExpenses('11/8 목양실 커피 23,000 카드\n교회학교 간식 45000\n전기요금 152,300원 계좌이체\n김장로 부친상 조화 10만원', { accounts: d.accounts, refDate: '2026-11-09' });
  assert.deepEqual(r.map((x) => [x.date, x.amount, x.accountId]), [['2026-11-08', 23000, '262'], [null, 45000, '221'], [null, 152300, '251'], [null, 100000, '242']]);
  assert.equal(r[0].method, '카드');
  // 학습: 처음 보는 메모라도 같은 메모를 과거에 확정했으면 그 계정
  const c = classifyExpense('목양실 다과', d.accounts, [{ memo: '목양실 다과', accountId: '214' }]);
  assert.equal(c.accountId, '214'); assert.equal(c.confidence, 'high');
});

test('표 붙여넣기(엑셀 탭·CSV 따옴표)', () => {
  assert.deepEqual(parseTable('1\t김철수\t20000\n2\t이영희\t15000'), [['1', '김철수', '20000'], ['2', '이영희', '15000']]);
  assert.deepEqual(parseTable('"a,b",c\n"x ""y""",z'), [['a,b', 'c'], ['x "y"', 'z']]);
});

test('장부: 추가·수정·삭제·마감·감사로그 체인/변조 탐지', () => {
  const d = sampleDoc();
  const t = addTx(d, { date: '2026-10-04', kind: 'in', accountId: '102', amount: 100000, memberId: d.members[0].id, donor: '김철수' });
  assert.throws(() => addTx(d, { date: '2026-10-04', kind: 'in', accountId: '201', amount: 1 }), /불일치/);
  assert.throws(() => addTx(d, { date: '2026-13-04', kind: 'in', accountId: '102', amount: 1 }), /날짜/);
  updateTx(d, t.id, { amount: 110000 });
  assert.throws(() => deleteTx(d, t.id), /사유/);
  lockPeriod(d, '2026-10-31', '10월 결산');
  assert.throws(() => updateTx(d, t.id, { amount: 120000 }), /마감/);
  updateTx(d, t.id, { amount: 120000 }, { reason: '계수 오류 정정' });
  assert.throws(() => addTx(d, { date: '2026-10-11', kind: 'in', accountId: '101', amount: 5000 }), /마감/);
  assert.equal(verifyAudit(d).ok, true);
  // 변조: 감사로그 내용 바꾸면 탐지
  const e = d.audit.find((x) => x.act === 'update');
  e.summary = e.summary.replace(/\d+원/, '1원'); // 금액 위조 시도
  const v = verifyAudit(d);
  assert.equal(v.ok, false); assert.ok(v.problems.some((p) => p.problem === '내용 변조'));
  // 주민번호는 감사로그에 남지 않는다
  assert.ok(!JSON.stringify(d.audit).includes('9001011234567'));
});

test('회계연도 이름·범위', () => {
  assert.equal(fyOf('2026-05-01', 1), 2026);
  assert.equal(fyOf('2025-12-15', 12), 2026); // 12월 시작 → 2025.12~2026.11 = 2026년도
  assert.deepEqual(fyRange(2026, 12), { from: '2025-12-01', to: '2026-11-30' });
  assert.deepEqual(fyRange(2026, 3), { from: '2026-03-01', to: '2027-02-28' });
  assert.deepEqual(periodRange('quarter', '2026-05-20', 1), { from: '2026-04-01', to: '2026-06-30', label: '2분기' });
  assert.deepEqual(periodRange('week', '2026-11-11'), { from: '2026-11-08', to: '2026-11-14', label: '주간' });
});

test('결산: 이월 자동·특별회계 분리·예산 대비·감사 점검', () => {
  const d = sampleDoc();
  setOpening(d, 2025, '일반회계', 1000000);
  addTx(d, { date: '2025-12-28', kind: 'in', accountId: '101', amount: 500000 });
  addTx(d, { date: '2026-01-04', kind: 'in', accountId: '102', amount: 300000, memberId: d.members[0].id, donor: '김철수' });
  addTx(d, { date: '2026-01-04', kind: 'in', accountId: '105', amount: 200000, memberId: d.members[1].id, donor: '이영희' }); // 건축회계
  addTx(d, { date: '2026-01-05', kind: 'out', accountId: '251', amount: 120000, memo: '전기요금' });
  addTx(d, { date: '2026-01-05', kind: 'out', accountId: '251', amount: 120000, memo: '전기요금' }); // 중복 의심
  setBudget(d, 2026, { 251: 1200000, 102: 3000000 }, { status: '확정' });
  // 2026 기초 = 2025 이월 1,000,000 + 500,000 (직접 입력 없으므로 자동)
  assert.equal(openingOf(d, 2026, '일반회계'), 1500000);
  const s = summarize(d, '2026-01-01', '2026-01-31');
  assert.equal(s.byFund['일반회계'].opening, 1500000);
  assert.equal(s.byFund['일반회계'].closing, 1500000 + 300000 - 240000);
  assert.equal(s.byFund['건축회계'].closing, 200000);
  assert.equal(s.totals.closing, 1500000 + 500000 - 240000);
  const row = s.rows.find((r) => r.id === '251');
  assert.equal(row.ytd, 240000); assert.equal(row.rate, 20);
  assert.ok(s.flags.some((f) => f.msg.startsWith('중복 의심')));
  assert.ok(s.flags.some((f) => f.msg.startsWith('증빙 없음')));
  assert.equal(balanceAt(d, '2026-01-04', '일반회계'), 1800000);
  // 보고서 HTML: 사용자 입력 이스케이프
  addTx(d, { date: '2026-01-06', kind: 'out', accountId: '261', amount: 1000, memo: '<img src=x onerror=alert(1)>' });
  const html = financeReportHtml(d, summarize(d, '2026-01-01', '2026-01-31'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('헌금 계수 불일치 탐지', () => {
  const d = sampleDoc();
  addTx(d, { date: '2026-11-08', kind: 'in', accountId: '101', amount: 60000, method: '현금' });
  upsertBatch(d, { date: '2026-11-08', counters: ['갑', '을'], cash: { 50000: 1, 10000: 0, 5000: 1 } });
  const s = summarize(d, '2026-11-08', '2026-11-08');
  assert.ok(s.flags.some((f) => f.msg.includes('현금 계수 불일치')));
});

test('개인별 헌금 합계·기부금영수증 일련번호(중복 없음·재발급 무효화)', () => {
  const d = sampleDoc();
  const kim = d.members[0];
  addTx(d, { date: '2026-01-04', kind: 'in', accountId: '102', amount: 100000, memberId: kim.id, donor: '김철수' });
  addTx(d, { date: '2026-02-01', kind: 'in', accountId: '103', amount: 50000, memberId: kim.id, donor: '김철수' });
  addTx(d, { date: '2026-02-01', kind: 'in', accountId: '151', amount: 3000 }); // 이자: 영수증 대상 아님
  addTx(d, { date: '2026-02-01', kind: 'in', accountId: '101', amount: 7000, donor: '무명' });
  addTx(d, { date: '2025-12-28', kind: 'in', accountId: '102', amount: 999999, memberId: kim.id, donor: '김철수' }); // 다른 연도
  const t = donorTotals(d, 2026);
  assert.equal(t.length, 1); assert.equal(t[0].total, 150000);
  const r1 = issueReceipt(d, 2026, t[0].key);
  const r2 = issueReceipt(d, 2026, t[0].key);
  assert.equal(r1.serial, '2026-001'); assert.equal(r2.serial, '2026-002');
  assert.equal(r1.voided, true); assert.deepEqual(r2.reissueOf, ['2026-001']);
  const html = receiptHtml(d, r2, kim, { showRrn: false });
  assert.ok(html.includes('900101-1******') && !html.includes('1234567'));
});

test('AI 브릿지: 파이프 형식 해석·합계 검산·로컬 분류 보완', () => {
  const d = sampleDoc();
  const p = setupPrompt(d);
  assert.ok(p.includes('102십일조') && p.includes('O|YYYYMMDD'));
  const r = parseBridge('```\nI|20261108|102|김철수|100000\nI|20261108|103|#2&박민수|50000\nO|20261107|?|23000|이마트 커피 다과\nT|173000\n```', d);
  assert.equal(r.offerings.length, 2); assert.equal(r.expenses.length, 1);
  assert.equal(r.offerings[1].donor, '이영희'); assert.equal(r.offerings[1].donor2, '박민수');
  assert.equal(r.expenses[0].accountId, '262');
  assert.equal(r.totalOk, true);
  const bad = parseBridge('O|20261107|251|10000|전기\nT|20000', d);
  assert.equal(bad.totalOk, false);
});

test('기기 간 병합: 최신 수정 우선·추가 보존', () => {
  const a = sampleDoc();
  const b = JSON.parse(JSON.stringify(a));
  b.deviceId = 'other-device';
  const t = addTx(a, { date: '2026-01-04', kind: 'in', accountId: '101', amount: 1000 });
  addTx(b, { date: '2026-01-05', kind: 'in', accountId: '101', amount: 2000 });
  const st = mergeDocs(a, b);
  assert.equal(liveTxs(a).length, 2); assert.equal(st.txs.added, 1);
  assert.ok(a.txs.find((x) => x.id === t.id));
  assert.equal(verifyAudit(a).ok, true);
});

test('암호화: 비밀번호·복구코드로 열기, 틀리면 거부, 비밀번호 변경', async () => {
  const rc = genRecoveryCode();
  assert.match(rc, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
  assert.equal(checkPassword('1234'), '비밀번호는 8자 이상');
  const { keyring, key } = await createKeyring('교회재정2026!', rc, 1000);
  const box = await encryptJson(key, { hello: '헌금' });
  assert.ok(!box.ct.includes('헌금'));
  const k2 = await unlockKeyring(keyring, '교회재정2026!');
  assert.deepEqual(await decryptJson(k2, box), { hello: '헌금' });
  const k3 = await unlockKeyring(keyring, rc.toLowerCase().replace(/-/g, ' '), 'rc');
  assert.deepEqual(await decryptJson(k3, box), { hello: '헌금' });
  await assert.rejects(unlockKeyring(keyring, '틀린비밀번호'), /맞지 않습니다/);
  const kr2 = await rewrapPassword(keyring, rc, '새비밀번호123', 'rc', 1000);
  const k4 = await unlockKeyring(kr2, '새비밀번호123');
  assert.deepEqual(await decryptJson(k4, box), { hello: '헌금' });
  const bb = await encryptBytes(key, new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await decryptBytes(k4, bb))], [1, 2, 3]);
});

test('ZIP·엑셀 파일이 표준 도구로 열린다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-'));
  const z = makeZip([{ name: '보고서.txt', data: '안녕' }, { name: 'a/b.bin', data: new Uint8Array([0, 255]) }]);
  writeFileSync(join(dir, 't.zip'), z);
  const x = makeXlsx([{ name: '거래', rows: [['날짜', '금액'], ['2026-01-04', 100000], ['<위험>&', -5]] }]);
  writeFileSync(join(dir, 't.xlsx'), x);
  const out = execFileSync('python3', ['-I', '-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read('보고서.txt').decode())
x=zipfile.ZipFile(sys.argv[2]); assert x.testzip() is None
import xml.dom.minidom as m
for n in x.namelist():
  if n.endswith('.xml') or n.endswith('.rels'): m.parseString(x.read(n))
print('xlsx-ok')`, join(dir, 't.zip'), join(dir, 't.xlsx')]).toString();
  assert.match(out, /안녕/); assert.match(out, /xlsx-ok/);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.ok(toCsv([['=SUM(A1)', -5]]).includes(`"'=SUM(A1)",-5`));
});

test('한글 금액·지출결의서', () => {
  assert.equal(koreanAmountText(150000), '일십오만');
  assert.equal(koreanAmountText(1234500), '일백이십삼만사천오백');
  assert.equal(koreanAmountText(100000000), '일억');
  const d = sampleDoc();
  const t = addTx(d, { date: '2026-11-08', kind: 'out', accountId: '262', amount: 23000, memo: '커피' });
  assert.ok(voucherHtml(d, t).includes('일금 이만삼천원정'));
});
