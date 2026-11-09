// 결산·보고 엔진 — AI 없이 결정론적으로 계산 (토큰 0, 재현 가능)
import { fyOf, fyRange, liveTxs, funds as fundList, isLocked, lockedThrough } from './ledger.js';
import { sundayOf, addDays, monthStart, monthEnd, addMonths, todayLocal, uid } from './util.js';
import { appendAudit } from './ledger.js';

const accMap = (doc) => new Map(doc.accounts.map((a) => [a.id, a]));
export const fundOf = (doc, t, m = accMap(doc)) => m.get(t.accountId)?.fund || '일반회계';

/** 기간 프리셋 → {from,to,label} */
export function periodRange(preset, ref = todayLocal(), fyStartMonth = 1) {
  switch (preset) {
    case 'week': { const f = sundayOf(ref); return { from: f, to: addDays(f, 6), label: '주간' }; }
    case 'month': return { from: monthStart(ref), to: monthEnd(ref), label: `${+ref.slice(5, 7)}월` };
    case 'prevmonth': { const p = addMonths(monthStart(ref), -1); return { from: p, to: monthEnd(p), label: `${+p.slice(5, 7)}월` }; }
    case 'quarter': case 'half': {
      const fy = fyOf(ref, fyStartMonth); const { from } = fyRange(fy, fyStartMonth);
      const span = preset === 'quarter' ? 3 : 6;
      const idx = Math.floor(monthsBetween(from, ref) / span);
      const f = addMonths(from, idx * span);
      return { from: f, to: addDays(addMonths(f, span), -1), label: preset === 'quarter' ? `${idx + 1}분기` : (idx ? '하반기' : '상반기') };
    }
    case 'fy': { const fy = fyOf(ref, fyStartMonth); return { ...fyRange(fy, fyStartMonth), label: `${fy}년도` }; }
    case 'ytd': { const fy = fyOf(ref, fyStartMonth); return { from: fyRange(fy, fyStartMonth).from, to: ref, label: `${fy}년도 누계` }; }
    default: throw new Error('알 수 없는 기간');
  }
}
function monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }

/** 회계연도 기초 이월금: 직접 입력값 우선, 없으면 전년도 기말잔액을 자동 이월 */
export function openingOf(doc, fy, fund, depth = 0) {
  const o = doc.openings?.[fy]?.funds;
  if (o && o[fund] !== undefined) return o[fund];
  if (depth > 30) return 0;
  const sm = doc.settings.fyStartMonth || 1;
  const { from } = fyRange(fy, sm);
  const m = accMap(doc);
  const prior = liveTxs(doc).filter((t) => t.date < from && fundOf(doc, t, m) === fund);
  if (!prior.length && !Object.keys(doc.openings || {}).some((k) => +k < fy)) return 0;
  const prev = fyRange(fy - 1, sm);
  return openingOf(doc, fy - 1, fund, depth + 1) + net(prior.filter((t) => t.date >= prev.from));
}
function net(txs) { return txs.reduce((s, t) => s + (t.kind === 'in' ? t.amount : -t.amount), 0); }

/** 특정일 '시작 시점'의 잔액 (그날 거래 제외) */
export function balanceBefore(doc, date, fund) {
  const sm = doc.settings.fyStartMonth || 1;
  const fy = fyOf(date, sm);
  const { from } = fyRange(fy, sm);
  const m = accMap(doc);
  return openingOf(doc, fy, fund) + net(liveTxs(doc).filter((t) => t.date >= from && t.date < date && fundOf(doc, t, m) === fund));
}
export function balanceAt(doc, date, fund) { return balanceBefore(doc, addDays(date, 1), fund); }

/** 메인 결산 */
export function summarize(doc, from, to) {
  const m = accMap(doc);
  const sm = doc.settings.fyStartMonth || 1;
  const all = liveTxs(doc);
  const txs = all.filter((t) => t.date >= from && t.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const fl = fundList(doc);
  const byFund = {};
  for (const f of fl) {
    const opening = balanceBefore(doc, from, f);
    const inn = txs.filter((t) => t.kind === 'in' && fundOf(doc, t, m) === f).reduce((s, t) => s + t.amount, 0);
    const out = txs.filter((t) => t.kind === 'out' && fundOf(doc, t, m) === f).reduce((s, t) => s + t.amount, 0);
    byFund[f] = { opening, in: inn, out, closing: opening + inn - out };
  }
  // 계정별
  const byAcc = {};
  for (const t of txs) {
    const k = t.accountId || '_';
    (byAcc[k] ||= { amount: 0, count: 0 }).amount += t.amount;
    byAcc[k].count++;
  }
  // 예산 대비 (기간 끝이 속한 회계연도, 연초~기간끝 누계)
  const fy = fyOf(to, sm);
  const fyR = fyRange(fy, sm);
  const budget = doc.budgets?.[fy];
  const ytd = {};
  for (const t of all) if (t.date >= fyR.from && t.date <= to) ytd[t.accountId || '_'] = (ytd[t.accountId || '_'] || 0) + t.amount;
  const rows = doc.accounts.filter((a) => a.active !== false || byAcc[a.id] || ytd[a.id]).map((a) => {
    const b = budget?.items?.[a.id] || 0;
    const y = ytd[a.id] || 0;
    return { id: a.id, kind: a.kind, gwan: a.gwan, name: a.name, fund: a.fund || '일반회계', period: byAcc[a.id]?.amount || 0, count: byAcc[a.id]?.count || 0, budget: b, ytd: y, rate: b ? Math.round((y / b) * 1000) / 10 : null };
  });
  if (byAcc._ || ytd._) rows.push({ id: '_', kind: 'out', gwan: '미분류', name: '미분류 지출', fund: '일반회계', period: byAcc._?.amount || 0, count: byAcc._?.count || 0, budget: 0, ytd: ytd._ || 0, rate: null });
  const totals = {
    in: txs.filter((t) => t.kind === 'in').reduce((s, t) => s + t.amount, 0),
    out: txs.filter((t) => t.kind === 'out').reduce((s, t) => s + t.amount, 0),
  };
  totals.opening = Object.values(byFund).reduce((s, f) => s + f.opening, 0);
  totals.closing = totals.opening + totals.in - totals.out;
  return { from, to, fy, fyRange: fyR, budgetStatus: budget?.status || '없음', txs, rows, byFund, totals, flags: auditFlags(doc, txs), weekly: weeklyMatrix(doc, txs), monthly: monthlyFlow(txs), bank: bankCompare(doc, from, to) };
}

/** 주일별 헌금 종류 매트릭스 (주간 보고서·헌금수입주계표) */
export function weeklyMatrix(doc, txs) {
  const weeks = {};
  for (const t of txs) if (t.kind === 'in') {
    const w = sundayOf(t.date);
    (weeks[w] ||= {});
    weeks[w][t.accountId] = (weeks[w][t.accountId] || 0) + t.amount;
  }
  const cols = doc.accounts.filter((a) => a.kind === 'in' && Object.values(weeks).some((w) => w[a.id]));
  return { weeks: Object.keys(weeks).sort().map((w) => ({ week: w, cells: weeks[w], total: Object.values(weeks[w]).reduce((s, v) => s + v, 0) })), cols };
}
export function monthlyFlow(txs) {
  const mm = {};
  for (const t of txs) { const k = t.date.slice(0, 7); (mm[k] ||= { in: 0, out: 0 })[t.kind] += t.amount; }
  return Object.keys(mm).sort().map((k) => ({ month: k, ...mm[k], net: mm[k].in - mm[k].out }));
}

/** 자동 감사 점검 — 사람이 놓치기 쉬운 것을 먼저 짚어 준다 */
export function auditFlags(doc, txs) {
  const flags = [];
  const th = doc.settings.receiptThreshold || 0;
  for (const t of txs) {
    if (t.kind === 'out' && !(t.attachments?.length) && !t.noReceiptReason && t.amount >= th) flags.push({ level: 'warn', txId: t.id, msg: `증빙 없음: ${t.date} ${t.memo || ''} ${t.amount.toLocaleString()}원` });
    if (t.kind === 'out' && !t.accountId) flags.push({ level: 'warn', txId: t.id, msg: `미분류 지출: ${t.date} ${t.memo || ''}` });
    if (t.kind === 'out' && t.method === '현금' && t.amount >= 500000) flags.push({ level: 'info', txId: t.id, msg: `고액 현금 지출: ${t.date} ${t.amount.toLocaleString()}원` });
  }
  // 중복 의심: 같은 날·종류·계정·금액·이름/메모
  const seen = new Map();
  for (const t of txs) {
    const k = [t.date, t.kind, t.accountId, t.amount, t.memberId || t.donor, t.memo].join('|');
    if (seen.has(k)) flags.push({ level: 'warn', txId: t.id, msg: `중복 의심: ${t.date} ${t.donor || t.memo || ''} ${t.amount.toLocaleString()}원` });
    else seen.set(k, t.id);
  }
  // 현금 계수 vs 장부 대조
  for (const b of doc.batches || []) {
    const dayCash = txs.filter((t) => t.kind === 'in' && t.date === b.date && t.method === '현금').reduce((s, t) => s + t.amount, 0);
    if (txs.some((t) => t.date === b.date) && b.cashTotal !== dayCash) flags.push({ level: 'warn', msg: `현금 계수 불일치 ${b.date}: 계수 ${b.cashTotal.toLocaleString()}원 ≠ 장부 현금 ${dayCash.toLocaleString()}원` });
    if (txs.some((t) => t.date === b.date) && (b.counters || []).filter(Boolean).length < 2) flags.push({ level: 'info', msg: `계수자 2인 미기재 ${b.date}` });
  }
  // 마감 후 수정 이력
  const lt = lockedThrough(doc);
  if (lt) {
    const late = doc.audit.filter((e) => (e.act === 'update' || e.act === 'delete' || e.act === 'add') && e.reason && isLocked(doc, (e.after || e.before)?.date));
    for (const e of late) flags.push({ level: 'info', msg: `마감 후 변경: ${e.summary} (사유: ${e.reason})` });
  }
  return flags;
}

export function bankCompare(doc, from, to) {
  return (doc.bankChecks || []).filter((c) => c.date >= from && c.date <= to).map((c) => {
    const book = balanceAt(doc, c.date, c.fund);
    return { ...c, book, diff: c.amount - book };
  });
}

// ── 개인별 헌금 (기부금영수증 기초) — 세법상 귀속은 '달력 연도' ──
export function donorTotals(doc, year) {
  const m = accMap(doc);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const res = new Map();
  for (const t of liveTxs(doc)) {
    if (t.kind !== 'in' || t.date < from || t.date > to) continue;
    const a = m.get(t.accountId);
    if (!a || a.receipt === false) continue;
    const key = t.memberId || (t.donor && t.donor !== '무명' ? 'n:' + t.donor : null);
    if (!key) continue;
    const r = res.get(key) || { key, memberId: t.memberId || null, name: t.donor, total: 0, months: {}, byAcc: {} };
    r.total += t.amount;
    const mo = t.date.slice(0, 7);
    r.months[mo] = (r.months[mo] || 0) + t.amount;
    r.byAcc[a.name] = (r.byAcc[a.name] || 0) + t.amount;
    res.set(key, r);
  }
  const mem = new Map(doc.members.map((x) => [x.id, x]));
  return [...res.values()].map((r) => ({ ...r, member: r.memberId ? mem.get(r.memberId) : null, name: r.memberId ? mem.get(r.memberId)?.name || r.name : r.name })).sort((a, b) => (a.member?.no || 1e9) - (b.member?.no || 1e9) || b.total - a.total);
}

/** 기부금영수증 발급 — 연도별 일련번호(중복 없음), 발급대장 기록 */
export function issueReceipt(doc, year, donorKey) {
  const d = donorTotals(doc, year).find((x) => x.key === donorKey);
  if (!d || d.total <= 0) throw new Error('해당 연도 헌금 내역이 없습니다');
  const prev = doc.receipts.filter((r) => r.year === year && !r.voided && r.donorKey === donorKey);
  for (const p of prev) { p.voided = true; p.updatedAt = new Date().toISOString(); } // 재발급 시 이전 것 무효
  const seq = doc.receipts.filter((r) => r.year === year).reduce((mx, r) => Math.max(mx, +r.serial.split('-')[1]), 0) + 1;
  const r = { id: uid(), serial: `${year}-${String(seq).padStart(3, '0')}`, year, donorKey, memberId: d.memberId, name: d.name, amount: d.total, months: d.months, issuedAt: todayLocal(), voided: false, updatedAt: new Date().toISOString(), reissueOf: prev.map((p) => p.serial) };
  doc.receipts.push(r);
  appendAudit(doc, 'receipt', r.id, `기부금영수증 ${r.serial} ${r.name} ${r.amount}원${prev.length ? ' (재발급)' : ''}`);
  return r;
}

/** 연간 발급 합계 — 3억원 이상이면 전자기부금영수증 의무 안내 대상 */
export function receiptYearTotal(doc, year) {
  return doc.receipts.filter((r) => r.year === year && !r.voided).reduce((s, r) => s + r.amount, 0);
}
