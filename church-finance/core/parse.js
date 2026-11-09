// 로컬 규칙 파서 — 타이핑·음성받아쓰기·붙여넣기 문장을 AI 없이(토큰 0) 구조화
//   "십일조 김철수 10만원, 감사 이영희 5만"  → 헌금 2건
//   "12 십일조 10만" / "#12" / "김철수(12)"   → 교인번호 12
//   "3"  (주일헌금)                           → 교인 3번의 주정 금액 자동
//   "11/8 목양실 커피 23,000 카드"            → 지출 1건 + 계정 자동분류
import { todayLocal, isYmd } from './util.js';

const DIG = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL = { 십: 10, 백: 100, 천: 1000 };
const BIG = { 만: 1e4, 억: 1e8 }; // '조'는 십일조와 충돌 → 단위에서 제외(교회 재정에 불필요)
const NUMCH = /^[0-9.영공일이삼사오육륙칠팔구십백천만억]+$/;

/** "10만5천원" "삼십이만 사천" "1,234,500" "1.5만" "일금 십만원정" → 정수, 아니면 null */
export function parseKoreanAmount(input) {
  let s = String(input).replace(/\s+/g, '').replace(/,/g, '');
  s = s.replace(/^일금/, '').replace(/원정?$/, '').replace(/정$/, '');
  if (!s || !NUMCH.test(s)) return null;
  let total = 0, section = 0, cur = null;
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const t = s.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(t) || cur !== null) return null;
      cur = parseFloat(t); i = j; continue;
    }
    if (ch in DIG) { if (cur !== null) return null; cur = DIG[ch]; i++; continue; }
    if (ch in SMALL) { section += (cur ?? 1) * SMALL[ch]; cur = null; i++; continue; }
    if (ch in BIG) { section += cur ?? 0; if (section === 0) section = 1; total += section * BIG[ch]; section = 0; cur = null; i++; continue; }
    return null;
  }
  total += section + (cur ?? 0);
  const v = Math.round(total);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

// 토큰이 금액인지 판정. strong=확실한 금액, weak=단독 단위(만/천/원)처럼 인접할 때만 금액
function amountKind(tok) {
  if (tok === '원') return 'won';
  const hasDigit = /[0-9]/.test(tok);
  const endsWon = /원정?$/.test(tok);
  const core = tok.replace(/원정?$/, '');
  if (!core) return null;
  if (parseKoreanAmount(tok) === null) return null;
  if (hasDigit) {
    // 콤마·단위·원 없는 1000 미만 정수는 교인번호 후보
    if (/^\d+$/.test(tok) && +tok < 1000) return 'num';
    return 'strong';
  }
  if (endsWon) return 'strong';
  if (core.length === 1) return /[만천백억]/.test(core) ? 'weak' : null;
  // 한글 수사만 있는 토큰은 백·천·만·억이 있어야 금액('십일' 같은 말 오인 방지)
  return /[백천만억]/.test(core) ? 'strong' : null;
}

const TITLES = ['안수집사', '집사님', '권사님', '장로님', '목사님', '전도사님', '성도님', '집사', '권사', '장로', '목사', '전도사', '성도', '청년', '권찰', '형제', '자매', '교우', '님'];
const METHOD = [['계좌이체', '계좌'], ['온라인', '계좌'], ['이체', '계좌'], ['계좌', '계좌'], ['송금', '계좌'], ['통장', '계좌'], ['현금', '현금'], ['카드', '카드'], ['법인카드', '카드']];
const ANON = ['무명', '익명', '무기명'];
function isNoise(t) { const n = norm(t); return METHOD.some(([w]) => n === w) || TITLES.includes(t) || FILLER.includes(t); }
const FILLER = ['부부', '공동', '내외', '가정', '가족', '헌금', '드림', '드립니다', '입니다', '이요', '요'];

/** 날짜 표현을 찾아 {date, rest} 로. 기준연도는 refDate */
export function extractDate(text, refDate = todayLocal()) {
  const y0 = +refDate.slice(0, 4);
  const pad = (n) => String(n).padStart(2, '0');
  const pats = [
    [/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/, (m) => `${m[1]}-${pad(m[2])}-${pad(m[3])}`],
    [/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => `${y0}-${pad(m[1])}-${pad(m[2])}`],
    [/(?<![\d.,])(\d{1,2})[/.](\d{1,2})(?![\d.,만천백억원])/, (m) => `${y0}-${pad(m[1])}-${pad(m[2])}`],
  ];
  for (const [re, f] of pats) {
    const m = re.exec(text);
    if (m) {
      const d = f(m);
      if (isYmd(d)) return { date: d, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim() };
    }
  }
  if (/(^|\s)오늘(\s|$)/.test(text)) return { date: refDate, rest: text.replace(/(^|\s)오늘(\s|$)/, ' ').trim() };
  return { date: null, rest: text };
}

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

/** 수입 계정 별칭 사전 (긴 별칭 우선) */
function aliasTable(accounts, kind) {
  const rows = [];
  for (const a of accounts) {
    if (a.kind !== kind || a.active === false) continue;
    const names = new Set([a.name, ...(a.aliases || [])].map(norm).filter(Boolean));
    for (const n of names) rows.push([n, a.id]);
  }
  return rows.sort((x, y) => y[0].length - x[0].length);
}

function tokenize(seg) {
  let s = seg
    .replace(/([가-힣]{2,5})\((\d{1,4})\)/g, '$1 #$2') // 김철수(12)
    .replace(/(\d{1,4})\s*번(?![가-힣])/g, '#$1')      // 12번
    .replace(/([가-힣a-zA-Z)])(\d)/g, '$1 $2')          // 김철수10만 → 김철수 10만
    .replace(/[·&/+]/g, ' & ')
    .replace(/[:"'“”‘’()[\]{}]/g, ' ');
  return s.split(/\s+/).filter(Boolean);
}

function splitSegments(text, forExpense) {
  const re = forExpense ? /\n|;/ : /\n|;|,(?!\d{3})|그리고|(?<!\d)\.(?!\d)|\.(?=\s|$)/;
  return String(text || '').split(re).map((s) => s.trim()).filter(Boolean);
}

function findMember(members, { no, name }) {
  if (no != null) return members.find((m) => +m.no === +no && m.status !== '중지') || members.find((m) => +m.no === +no) || null;
  if (name) {
    const hits = members.filter((m) => norm(m.name) === norm(name) && m.status !== '중지');
    return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

/**
 * 헌금 문장 파싱
 * @returns items: [{date, accountId, memberId, donor, memberId2, donor2, amount, method, memo, warnings[]}]
 */
export function parseOfferings(text, { accounts, members = [], defaultAccountId, date, refDate } = {}) {
  const aliases = aliasTable(accounts, 'in');
  const weeklyAcc = accounts.find((a) => a.id === '101');
  const out = [];
  for (const seg0 of splitSegments(text, false)) {
    const { date: d, rest } = extractDate(seg0, refDate || date || todayLocal());
    const toks = tokenize(rest);
    // 금액 덩어리(run) 기준으로 항목 분할 (헌금 종류 별칭이 들어간 토큰은 금액 아님)
    const kinds = toks.map((t) => (aliases.some(([al]) => norm(t).includes(al)) ? null : amountKind(t)));
    const groups = [];
    let cur = [];
    for (let i = 0; i < toks.length; i++) {
      const k = kinds[i];
      const isAmt = k === 'strong' || ((k === 'weak' || k === 'won') && (kinds[i - 1] === 'strong' || kinds[i - 1] === 'weak' || kinds[i + 1] === 'strong' || kinds[i + 1] === 'won'));
      cur.push({ t: toks[i], amt: isAmt, k });
      const nextAmt = i + 1 < toks.length && (kinds[i + 1] === 'strong' || kinds[i + 1] === 'won' || kinds[i + 1] === 'weak');
      if (isAmt && !nextAmt) { groups.push(cur); cur = []; }
    }
    if (cur.length) {
      // 금액 없는 꼬리: 앞 항목에 이름이 없으면 붙이고, 아니면 독립 항목(주정 자동 후보)
      const nameish = (c) => !c.amt && (c.k === 'num' || c.t.startsWith('#') || (/^[가-힣]{2,5}$/.test(c.t) && !isNoise(c.t) && !aliases.some(([al]) => norm(c.t).includes(al))));
      const tailHasPerson = cur.some(nameish);
      const prevHasPerson = groups.length && groups[groups.length - 1].some(nameish);
      // 꼬리가 '계좌이체'·'집사' 같은 부가어뿐이거나, 앞 항목에 이름이 없으면 앞 항목에 합침
      if (groups.length && (!tailHasPerson || !prevHasPerson)) {
        groups[groups.length - 1].push(...cur);
      } else groups.push(cur);
    }
    for (const g of groups) out.push(buildOffering(g, { aliases, members, defaultAccountId, weeklyAcc, date: d || date }));
  }
  return out.filter((it) => it.amount || it.donor || it.memberId);
}

function buildOffering(group, { aliases, members, defaultAccountId, weeklyAcc, date }) {
  const it = { date: date || null, accountId: null, memberId: null, donor: '', memberId2: null, donor2: '', amount: null, method: null, memo: '', warnings: [] };
  const amtText = group.filter((c) => c.amt).map((c) => c.t).join('');
  if (amtText) it.amount = parseKoreanAmount(amtText);
  const names = [];
  const memoParts = [];
  let memberNo = null;
  for (const c of group) {
    if (c.amt) continue;
    let t = c.t;
    if (t === '&') { names.push('&'); continue; }
    if (/^#\d{1,4}$/.test(t)) { memberNo = +t.slice(1); names.push({ no: memberNo }); continue; }
    if (c.k === 'num') { names.push({ no: +t }); continue; }
    const mt = METHOD.find(([w]) => norm(t) === w);
    if (mt) { it.method = mt[1]; continue; }
    // 헌금 종류(붙어 있는 경우 포함: 김철수십일조)
    if (!it.accountId) {
      const n = norm(t);
      const hit = aliases.find(([al]) => n.includes(al));
      if (hit) {
        it.accountId = hit[1];
        t = n.replace(hit[0], '').replace(/헌금$/, '');
        if (!t) continue;
      }
    }
    t = t.replace(/헌금$/, '');
    if (!t) continue;
    if (ANON.includes(t)) { names.push({ name: '무명' }); continue; }
    if (TITLES.includes(t) || FILLER.includes(t)) continue;
    for (const ti of TITLES) if (t.length > ti.length + 1 && t.endsWith(ti)) { t = t.slice(0, -ti.length); break; }
    if (/^[가-힣]{2,5}$/.test(t) || /^[a-zA-Z]{2,20}$/.test(t)) names.push({ name: t });
    else memoParts.push(c.t);
  }
  // 이름 1·2 (부부 공동)
  const ppl = names.filter((x) => x !== '&');
  const resolve = (p) => {
    if (!p) return { id: null, name: '' };
    if (p.name === '무명') return { id: null, name: '무명' };
    const m = findMember(members, p);
    if (m) return { id: m.id, name: m.name, weekly: m.weekly };
    if (p.no != null) return { id: null, name: '', bad: `교인번호 ${p.no} 없음` };
    return { id: null, name: p.name };
  };
  const p1 = resolve(ppl[0]);
  const p2 = resolve(ppl[1]);
  it.memberId = p1.id; it.donor = p1.name;
  it.memberId2 = p2.id; it.donor2 = p2.name;
  if (p1.bad) it.warnings.push(p1.bad);
  if (p2.bad) it.warnings.push(p2.bad);
  if (ppl.length > 2) it.warnings.push('이름이 3개 이상 — 확인 필요');
  if (!it.accountId) it.accountId = defaultAccountId || null;
  // 주정 자동: 금액이 없고 주일헌금이며 교인 주정액이 있으면
  if (it.amount == null && p1.weekly && (!it.accountId || it.accountId === weeklyAcc?.id)) {
    it.amount = +p1.weekly; it.accountId = weeklyAcc?.id || it.accountId; it.auto = '주정';
  }
  if (it.amount == null) it.warnings.push('금액 없음');
  else if (it.amount <= 0) it.warnings.push('금액 0');
  else if (it.amount < 1000) it.warnings.push('금액이 1,000원 미만 — 확인');
  if (!it.accountId) it.warnings.push('헌금 종류 없음');
  if (!it.donor && !it.memberId) it.donor = '무명';
  it.memo = memoParts.join(' ');
  return it;
}

// ── 지출 ──
function bigrams(s) {
  const t = norm(s).replace(/[^가-힣a-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/**
 * 지출 메모 → 계정 자동분류 (규칙 키워드 + 과거 입력 학습). 토큰 0.
 * history: [{memo, accountId}] (확정된 과거 지출)
 * @returns {accountId, confidence: 'high'|'mid'|'low', reason}
 */
export function classifyExpense(memo, accounts, history = []) {
  const n = norm(memo);
  if (!n) return { accountId: null, confidence: 'low', reason: '메모 없음' };
  const active = accounts.filter((a) => a.kind === 'out' && a.active !== false);
  const ids = new Set(active.map((a) => a.id));
  // 1) 같은 메모로 과거에 확정한 계정 (가장 강함)
  const counts = {};
  for (const h of history) if (ids.has(h.accountId) && norm(h.memo) === n) counts[h.accountId] = (counts[h.accountId] || 0) + 1;
  const exact = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (exact) return { accountId: exact[0], confidence: 'high', reason: '같은 메모 과거 기록' };
  // 2) 키워드 규칙: 일치한 키워드 길이 합
  let best = null, bestScore = 0, second = 0;
  for (const a of active) {
    let sc = 0;
    for (const k of [a.name, ...(a.keywords || [])]) { const kk = norm(k); if (kk.length >= 1 && n.includes(kk)) sc += kk.length; }
    if (sc > bestScore) { second = bestScore; bestScore = sc; best = a.id; } else if (sc > second) second = sc;
  }
  // 3) 과거 메모 유사도(2글자 조각 자카드)
  const bg = bigrams(memo);
  let simBest = null, sim = 0;
  if (bg.size) for (const h of history) {
    if (!ids.has(h.accountId)) continue;
    const hb = bigrams(h.memo);
    if (!hb.size) continue;
    let inter = 0; for (const x of bg) if (hb.has(x)) inter++;
    const j = inter / (bg.size + hb.size - inter);
    if (j > sim) { sim = j; simBest = h.accountId; }
  }
  if (sim >= 0.6 && simBest) return { accountId: simBest, confidence: 'high', reason: '비슷한 과거 메모' };
  if (best && bestScore >= 2) return { accountId: best, confidence: bestScore > second ? 'mid' : 'low', reason: '키워드' };
  if (sim >= 0.34 && simBest) return { accountId: simBest, confidence: 'low', reason: '과거 메모 유사' };
  if (best) return { accountId: best, confidence: 'low', reason: '키워드(약함)' };
  return { accountId: null, confidence: 'low', reason: '분류 단서 없음' };
}

/** 지출 문장 파싱: 한 줄 = 한 건 ("11/8 목양실 커피 23,000 카드") */
export function parseExpenses(text, { accounts, history = [], date, refDate } = {}) {
  const out = [];
  for (const seg of splitSegments(text, true)) {
    const { date: d, rest } = extractDate(seg, refDate || date || todayLocal());
    const toks = tokenize(rest).filter((t) => t !== '&');
    const kinds = toks.map(amountKind);
    let amtIdx = [];
    // 마지막 금액 덩어리를 금액으로
    for (let i = toks.length - 1; i >= 0; i--) {
      const k = kinds[i];
      if (k === 'strong' || k === 'won' || k === 'weak' || (k === 'num' && amtIdx.length === 0 && i === toks.length - 1 && !kinds.some((x) => x === 'strong'))) amtIdx.unshift(i);
      else if (amtIdx.length) break;
    }
    const it = { date: d || date || null, amount: null, memo: '', method: null, accountId: null, confidence: 'low', reason: '', warnings: [] };
    if (amtIdx.length) it.amount = parseKoreanAmount(amtIdx.map((i) => toks[i]).join(''));
    if (kinds.filter((k, i) => k === 'strong' && !amtIdx.includes(i)).length) it.warnings.push('금액이 여러 개 — 마지막 금액을 사용');
    const memo = [];
    toks.forEach((t, i) => {
      if (amtIdx.includes(i)) return;
      const mt = METHOD.find(([w]) => norm(t) === w);
      if (mt) { it.method = mt[1]; return; }
      memo.push(t);
    });
    it.memo = memo.join(' ').trim();
    const c = classifyExpense(it.memo, accounts, history);
    Object.assign(it, c);
    if (it.amount == null) it.warnings.push('금액 없음');
    if (!it.accountId) it.warnings.push('계정 미분류');
    if (it.amount != null || it.memo) out.push(it);
  }
  return out;
}

/** 교인 명부 붙여넣기(엑셀 복사 = 탭 구분) / CSV → 행 배열 */
export function parseTable(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  return lines.map((l) => splitCsvLine(l, delim).map((c) => c.trim()));
}
function splitCsvLine(line, d) {
  if (d === '\t') return line.split('\t');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
