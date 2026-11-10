// 장부 엔진 — 문서(doc) 하나에 교회 재정 전체를 담는다. 순수 함수 + doc 변형.
// 모든 변경은 감사로그(해시 체인)에 남고, 마감된 기간의 변경은 사유가 필수다.
import { cloneDefaultAccounts } from './accounts.js';
import { uid, isYmd, sha256, stableJson, addMonths, addDays } from './util.js';

export const SCHEMA = 1;
export const METHODS = ['현금', '계좌', '수표', '카드', '기타'];

export function createDoc({ churchName = '', fyStartMonth = 1, region = 'KR', deviceId = uid() } = {}) {
  const now = new Date().toISOString();
  return {
    schema: SCHEMA,
    app: 'boaz-ledger',
    deviceId,
    settings: {
      churchName, fyStartMonth, region, bizNo: '', address: '', rep: '', treasurer: '', phone: '',
      autoLockMin: 10, receiptThreshold: 0, updatedAt: now,
    },
    accounts: cloneDefaultAccounts().map((a) => ({ ...a, updatedAt: now })),
    budgets: {},       // { [fy]: { status:'작성중'|'확정', items:{[accId]:금액}, memo:{}, updatedAt } }
    openings: {},      // { [fy]: { funds:{[회계]:금액}, updatedAt } } 전기이월금
    bankChecks: [],    // 통장 잔액 대조 기록 [{id, date, fund, bank, amount, updatedAt}]
    members: [],
    txs: [],
    batches: [],       // 헌금 계수 기록 [{id, date, counters:[a,b], cash:{50000:n,...}, cashTotal, note, updatedAt}]
    receipts: [],      // 기부금영수증 발급대장 [{id, serial, year, memberId, name, amount, issuedAt, voided, updatedAt}]
    locks: [],         // 기간 마감 [{id, through:'YYYY-MM-DD', ts, note}]
    audit: [],
    updatedAt: now,
  };
}

// ── 회계연도 ──
/** 시작월이 1~6월이면 시작 연도, 7~12월이면 끝나는 연도로 이름 붙임 (예: 12월 시작 → 2025.12~2026.11 = 2026년도) */
export function fyOf(date, startMonth = 1) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const startYear = m >= startMonth ? y : y - 1;
  return startMonth <= 6 ? startYear : startYear + 1;
}
export function fyRange(fy, startMonth = 1) {
  const startYear = startMonth <= 6 ? fy : fy - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  return { from, to: addDays(addMonths(from, 12), -1) };
}

// ── 감사로그 (기기별 해시 체인) ──
export function appendAudit(doc, act, ref, summary, { reason = '', before, after } = {}) {
  const prev = [...doc.audit].reverse().find((e) => e.dev === doc.deviceId);
  const e = { id: uid(), seq: (prev?.seq || 0) + 1, ts: new Date().toISOString(), dev: doc.deviceId, act, ref, summary, reason, before, after, prev: prev?.hash || '' };
  e.hash = sha256(stableJson({ ...e, hash: undefined }));
  doc.audit.push(e);
  return e;
}
/** 감사로그 무결성 검증: 체인이 끊기거나 내용이 바뀐 항목을 찾아낸다 */
export function verifyAudit(doc) {
  const byDev = {};
  for (const e of doc.audit) (byDev[e.dev] ||= []).push(e);
  const problems = [];
  for (const [dev, list] of Object.entries(byDev)) {
    list.sort((a, b) => a.seq - b.seq);
    let prevHash = '';
    list.forEach((e, i) => {
      if (e.seq !== i + 1) problems.push({ id: e.id, problem: `순번 누락(기기 ${dev.slice(0, 6)})` });
      if (e.prev !== prevHash) problems.push({ id: e.id, problem: '체인 끊김' });
      if (sha256(stableJson({ ...e, hash: undefined })) !== e.hash) problems.push({ id: e.id, problem: '내용 변조' });
      prevHash = e.hash;
    });
  }
  return { ok: problems.length === 0, count: doc.audit.length, problems };
}

// ── 마감 ──
export function lockedThrough(doc) {
  return doc.locks.reduce((m, l) => (l.through > m ? l.through : m), '');
}
export function isLocked(doc, date) {
  const t = lockedThrough(doc);
  return !!t && !!date && date <= t;
}
export function lockPeriod(doc, through, note = '') {
  if (!isYmd(through)) throw new Error('마감일이 올바르지 않습니다');
  const l = { id: uid(), through, ts: new Date().toISOString(), note, updatedAt: new Date().toISOString() };
  doc.locks.push(l);
  appendAudit(doc, 'lock', l.id, `${through}까지 마감`, { reason: note });
  touch(doc);
  return l;
}

function touch(doc) { doc.updatedAt = new Date().toISOString(); }

// ── 거래 ──
const TX_FIELDS = ['date', 'kind', 'accountId', 'amount', 'memberId', 'donor', 'memberId2', 'donor2', 'method', 'memo', 'payee', 'attachments', 'noReceiptReason', 'source', 'batchId'];

export function validateTx(doc, t) {
  const errs = [];
  if (!isYmd(t.date)) errs.push('날짜 형식(YYYY-MM-DD)');
  if (t.kind !== 'in' && t.kind !== 'out') errs.push('수입/지출 구분');
  if (!Number.isInteger(t.amount) || t.amount <= 0) errs.push('금액은 1원 이상 정수');
  else if (t.amount > 1e11) errs.push('금액이 너무 큼');
  const acc = doc.accounts.find((a) => a.id === t.accountId);
  if (t.accountId && !acc) errs.push('없는 계정');
  if (acc && acc.kind !== t.kind) errs.push('계정의 수입/지출 구분 불일치');
  if (t.kind === 'in' && !t.accountId) errs.push('헌금 종류 필요');
  if (t.method && !METHODS.includes(t.method)) errs.push('결제 방법');
  for (const f of ['donor', 'donor2', 'payee']) if (t[f] && String(t[f]).length > 60) errs.push(`${f} 너무 김`);
  if (t.memo && String(t.memo).length > 500) errs.push('메모 500자 초과');
  return errs;
}

function pick(o) { const r = {}; for (const f of TX_FIELDS) if (o[f] !== undefined) r[f] = o[f]; return r; }
function txSummary(doc, t) {
  const a = doc.accounts.find((x) => x.id === t.accountId);
  return `${t.date} ${t.kind === 'in' ? '수입' : '지출'} ${a ? a.name : '미분류'} ${t.amount}원${t.donor ? ' ' + t.donor : ''}${t.memo ? ' ' + t.memo : ''}`;
}

export function addTx(doc, input, { reason = '' } = {}) {
  const now = new Date().toISOString();
  const t = { id: uid(), method: input.kind === 'in' ? '현금' : '계좌', memo: '', donor: '', attachments: [], source: '직접', ...pick(input), createdAt: now, updatedAt: now, deleted: false };
  t.amount = Math.round(Number(t.amount));
  const errs = validateTx(doc, t);
  if (errs.length) throw new Error('입력 오류: ' + errs.join(', '));
  if (isLocked(doc, t.date) && !reason.trim()) throw new Error(`마감된 기간(${lockedThrough(doc)}까지)입니다. 사유를 입력하세요.`);
  doc.txs.push(t);
  appendAudit(doc, 'add', t.id, txSummary(doc, t), { reason, after: pick(t) });
  touch(doc);
  return t;
}

export function updateTx(doc, id, patch, { reason = '' } = {}) {
  const t = doc.txs.find((x) => x.id === id && !x.deleted);
  if (!t) throw new Error('거래를 찾을 수 없습니다');
  const next = { ...t, ...pick(patch) };
  next.amount = Math.round(Number(next.amount));
  const errs = validateTx(doc, next);
  if (errs.length) throw new Error('입력 오류: ' + errs.join(', '));
  if ((isLocked(doc, t.date) || isLocked(doc, next.date)) && !reason.trim()) throw new Error('마감된 기간의 수정은 사유가 필요합니다');
  const before = pick(t);
  Object.assign(t, pick(next), { updatedAt: new Date().toISOString() });
  appendAudit(doc, 'update', t.id, txSummary(doc, t), { reason, before, after: pick(t) });
  touch(doc);
  return t;
}

export function deleteTx(doc, id, { reason = '' } = {}) {
  const t = doc.txs.find((x) => x.id === id && !x.deleted);
  if (!t) throw new Error('거래를 찾을 수 없습니다');
  if (!reason.trim()) throw new Error('삭제 사유를 입력하세요 (감사 기록용)');
  t.deleted = true;
  t.updatedAt = new Date().toISOString();
  appendAudit(doc, 'delete', t.id, txSummary(doc, t), { reason, before: pick(t) });
  touch(doc);
}

export function liveTxs(doc) { return doc.txs.filter((t) => !t.deleted); }

// ── 교인 명부 ──
const MEMBER_FIELDS = ['no', 'name', 'weekly', 'phone', 'rrn', 'address', 'familyId', 'status', 'note'];
export function upsertMember(doc, m) {
  const now = new Date().toISOString();
  const clean = {};
  for (const f of MEMBER_FIELDS) if (m[f] !== undefined) clean[f] = typeof m[f] === 'string' ? m[f].trim() : m[f];
  if (clean.no !== undefined) clean.no = parseInt(clean.no, 10);
  if (clean.weekly !== undefined) clean.weekly = Math.max(0, parseInt(String(clean.weekly).replace(/[^0-9]/g, '') || '0', 10));
  if (clean.rrn) clean.rrn = clean.rrn.replace(/[^0-9]/g, '');
  if (clean.rrn && clean.rrn.length !== 13) throw new Error('주민등록번호는 13자리입니다');
  let ex = m.id ? doc.members.find((x) => x.id === m.id) : null;
  const target = { ...(ex || { status: '사용', weekly: 0 }), ...clean };
  if (!target.name) throw new Error('이름이 필요합니다');
  if (!Number.isInteger(target.no) || target.no <= 0) target.no = nextMemberNo(doc);
  if (doc.members.some((x) => x.no === target.no && x.id !== ex?.id)) throw new Error(`교인번호 ${target.no} 이미 사용 중`);
  if (ex) {
    const changed = MEMBER_FIELDS.filter((f) => ex[f] !== target[f]);
    Object.assign(ex, target, { updatedAt: now });
    // 주민번호 값은 감사로그에 남기지 않는다(필드명만)
    appendAudit(doc, 'member', ex.id, `교인 ${ex.no} ${ex.name} 수정: ${changed.join(',')}`);
  } else {
    ex = { id: uid(), ...target, createdAt: now, updatedAt: now };
    doc.members.push(ex);
    appendAudit(doc, 'member', ex.id, `교인 ${ex.no} ${ex.name} 등록`);
  }
  touch(doc);
  return ex;
}
export function nextMemberNo(doc) { return doc.members.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1; }

// ── 계정 ──
export function upsertAccount(doc, a) {
  const now = new Date().toISOString();
  const ex = doc.accounts.find((x) => x.id === a.id);
  if (!a.name || !a.gwan) throw new Error('관과 항목 이름이 필요합니다');
  if (ex) { Object.assign(ex, a, { updatedAt: now }); appendAudit(doc, 'account', ex.id, `계정 ${ex.id} ${ex.gwan}›${ex.name} 수정`); }
  else {
    if (doc.accounts.some((x) => x.id === a.id)) throw new Error('코드 중복');
    doc.accounts.push({ fund: '일반회계', aliases: [], keywords: [], active: true, receipt: a.kind === 'in', ...a, updatedAt: now });
    appendAudit(doc, 'account', a.id, `계정 ${a.id} ${a.gwan}›${a.name} 추가`);
  }
  touch(doc);
}

export function funds(doc) {
  const s = new Set(['일반회계']);
  for (const a of doc.accounts) s.add(a.fund || '일반회계');
  return [...s];
}

// ── 예산 ──
export function setBudget(doc, fy, items, { status, memo } = {}) {
  const b = (doc.budgets[fy] ||= { status: '작성중', items: {}, memo: {} });
  if (b.status === '확정' && status !== '작성중') throw new Error('확정된 예산입니다. 수정하려면 먼저 확정을 해제하세요.');
  for (const [k, v] of Object.entries(items || {})) b.items[k] = Math.max(0, Math.round(Number(v) || 0));
  if (memo) Object.assign(b.memo, memo);
  if (status) b.status = status;
  b.updatedAt = new Date().toISOString();
  appendAudit(doc, 'budget', String(fy), `${fy}년도 예산 ${status || '저장'}`);
  touch(doc);
  return b;
}

export function setOpening(doc, fy, fund, amount) {
  const o = (doc.openings[fy] ||= { funds: {} });
  o.funds[fund] = Math.round(Number(amount) || 0);
  o.updatedAt = new Date().toISOString();
  appendAudit(doc, 'opening', String(fy), `${fy}년도 ${fund} 전기이월 ${o.funds[fund]}원`);
  touch(doc);
}

// ── 헌금 계수 기록 ──
/** 권종별 매수 → 합계. 키 = 권종의 최소단위 값(원 또는 센트)이라 지역과 무관 */
export function cashTotal(cash = {}) { return Object.entries(cash).reduce((s, [b, n]) => s + +b * (parseInt(n, 10) || 0), 0); }
export function upsertBatch(doc, b) {
  const now = new Date().toISOString();
  let ex = b.id && doc.batches.find((x) => x.id === b.id);
  const data = { date: b.date, counters: (b.counters || []).map((s) => String(s).trim()).slice(0, 2), cash: b.cash || {}, note: b.note || '' };
  data.cashTotal = cashTotal(data.cash);
  if (ex) Object.assign(ex, data, { updatedAt: now });
  else { ex = { id: uid(), ...data, createdAt: now, updatedAt: now }; doc.batches.push(ex); }
  appendAudit(doc, 'count', ex.id, `${ex.date} 헌금 계수 현금 ${ex.cashTotal}원 (계수: ${ex.counters.filter(Boolean).join('·') || '미기재'})`);
  touch(doc);
  return ex;
}

// ── 통장 잔액 대조 ──
export function addBankCheck(doc, { date, fund = '일반회계', bank = '', amount }) {
  if (!isYmd(date)) throw new Error('날짜 오류');
  const c = { id: uid(), date, fund, bank, amount: Math.round(Number(amount) || 0), updatedAt: new Date().toISOString() };
  doc.bankChecks.push(c);
  appendAudit(doc, 'bank', c.id, `${date} ${fund} ${bank} 통장잔액 ${c.amount}원 입력`);
  touch(doc);
  return c;
}

// ── 기기 간 병합 (백업 파일 가져오기) — 항목별 최신 수정 우선 ──
function mergeById(a = [], b = []) {
  const map = new Map(a.map((x) => [x.id, x]));
  let added = 0, updated = 0;
  for (const x of b) {
    const cur = map.get(x.id);
    if (!cur) { map.set(x.id, x); added++; }
    else if ((x.updatedAt || '') > (cur.updatedAt || '')) { map.set(x.id, x); updated++; }
  }
  return { list: [...map.values()], added, updated };
}
function mergeKeyed(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || (v.updatedAt || '') > (out[k].updatedAt || '')) out[k] = v;
  return out;
}
export function mergeDocs(local, incoming) {
  if (incoming.app !== 'boaz-ledger') throw new Error('이 앱의 장부 파일이 아닙니다');
  const stats = {};
  for (const key of ['txs', 'members', 'accounts', 'receipts', 'locks', 'batches', 'bankChecks']) {
    const r = mergeById(local[key], incoming[key]);
    local[key] = r.list;
    stats[key] = { added: r.added, updated: r.updated };
  }
  const audit = mergeById(local.audit, incoming.audit);
  local.audit = audit.list.sort((x, y) => (x.ts < y.ts ? -1 : 1));
  local.budgets = mergeKeyed(local.budgets, incoming.budgets);
  local.openings = mergeKeyed(local.openings, incoming.openings);
  if ((incoming.settings?.updatedAt || '') > (local.settings?.updatedAt || '')) local.settings = { ...incoming.settings };
  appendAudit(local, 'merge', '', `다른 기기 장부 병합: 거래 +${stats.txs.added}/수정${stats.txs.updated}`);
  touch(local);
  return stats;
}
