// AI 브릿지 — 무료 Claude/ChatGPT/Gemini 앱과 '복사·붙여넣기'로 연결 (API 키·과금 0)
// 형식: 파이프 한 줄 = 한 건 (JSON 대비 토큰 1.6~2.6배 절약, 연구팀 실측)
//   I|YYYYMMDD|코드|이름|금액          헌금
//   O|YYYYMMDD|코드|금액|거래처 메모    지출
//   T|합계                             검산용 합계
import { classifyExpense, parseKoreanAmount } from './parse.js';
import { isYmd } from './util.js';

function codeTable(doc) {
  const act = doc.accounts.filter((a) => a.active !== false);
  const short = (n) => n.replace(/헌금$/, '').replace(/\s+/g, '');
  const ins = act.filter((a) => a.kind === 'in').map((a) => a.id + short(a.name)).join(' ');
  const outs = act.filter((a) => a.kind === 'out').map((a) => a.id + short(a.name)).join(' ');
  return { ins, outs };
}

/** 한 번만 저장해 두는 지침 (Claude 프로젝트 / ChatGPT 프로젝트 / Gemini Gem) */
export function setupPrompt(doc) {
  const { ins, outs } = codeTable(doc);
  return [
    `너는 ${doc.settings.churchName || '우리 교회'} 재정 입력 도우미다. 사진·글·음성에서 거래를 뽑아 아래 형식의 줄만 출력한다. 인사·설명·코드블록 금지.`,
    '헌금: I|YYYYMMDD|코드|이름|금액',
    '지출: O|YYYYMMDD|코드|금액|거래처 메모',
    '마지막 줄: T|금액 합계',
    '규칙: 금액은 쉼표·원 없는 정수. 날짜를 모르면 ?. 이름을 모르면 무명. 부부 공동은 이름&이름. 교인번호가 보이면 #번호. 코드가 애매하면 ?. 영수증은 합계(결제금액) 한 줄, 메모는 품목 요약 10자 이내.',
    `수입코드: ${ins}`,
    `지출코드: ${outs}`,
  ].join('\n');
}

/** 매번 보낼 짧은 말 — 지침을 저장해 두면 이것만 보내면 된다 */
export const QUICK_PROMPTS = {
  receipt: '영수증',
  offering: '헌금',
  text: '정리',
};

/** 지침을 저장하지 않은 경우: 지침+요청을 한 번에 */
export function oneShotPrompt(doc, kind = 'receipt') {
  const ask = { receipt: '첨부한 영수증을 정리해.', offering: '첨부한 헌금 기록(봉투·계수표·명단)을 정리해.', text: '아래 글을 정리해:\n' }[kind];
  return setupPrompt(doc) + '\n\n' + ask;
}

/** AI 답변 붙여넣기 → 검증된 항목 */
export function parseBridge(text, doc, { date } = {}) {
  const res = { offerings: [], expenses: [], total: null, sum: 0, errors: [], lines: 0 };
  const accIds = new Set(doc.accounts.map((a) => a.id));
  const history = doc.txs.filter((t) => t.kind === 'out' && !t.deleted && t.accountId).map((t) => ({ memo: t.memo, accountId: t.accountId }));
  const lines = String(text || '').replace(/```[a-z]*|```/gi, '').replace(/｜/g, '|').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('|'));
  const toDate = (s) => {
    const d = String(s || '').replace(/[^0-9]/g, '');
    if (d.length === 8) { const v = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`; if (isYmd(v)) return v; }
    if (d.length === 4 && date) { const v = `${date.slice(0, 4)}-${d.slice(0, 2)}-${d.slice(2)}`; if (isYmd(v)) return v; }
    return date || null;
  };
  const amt = (s) => { const v = parseKoreanAmount(String(s || '').trim()); return v && v > 0 ? v : null; };
  for (const [i, line] of lines.entries()) {
    const f = line.split('|').map((x) => x.trim());
    const kind = f[0].toUpperCase();
    res.lines++;
    if (kind === 'T') { res.total = amt(f[1]); continue; }
    if (kind === 'I') {
      const [, d, code, name, a] = f;
      const it = { date: toDate(d), accountId: accIds.has(code) ? code : null, nameRaw: name || '무명', amount: amt(a), warnings: [], line: i + 1 };
      if (!it.accountId) it.warnings.push(`코드 ${code} 없음`);
      if (!it.amount) it.warnings.push('금액 오류');
      resolveNames(it, doc);
      res.offerings.push(it);
      res.sum += it.amount || 0;
    } else if (kind === 'O') {
      const [, d, code, a, ...memo] = f;
      const it = { date: toDate(d), amount: amt(a), memo: memo.join(' ').trim(), accountId: accIds.has(code) && doc.accounts.find((x) => x.id === code)?.kind === 'out' ? code : null, warnings: [], line: i + 1, confidence: 'high', reason: 'AI 코드' };
      if (!it.accountId) Object.assign(it, classifyExpense(it.memo, doc.accounts, history));
      if (!it.amount) it.warnings.push('금액 오류');
      if (!it.accountId) it.warnings.push('계정 미분류');
      res.expenses.push(it);
      res.sum += it.amount || 0;
    } else res.errors.push(`${i + 1}줄: 알 수 없는 형식 "${line.slice(0, 30)}"`);
  }
  res.totalOk = res.total == null ? null : res.total === res.sum;
  if (res.totalOk === false) res.errors.push(`합계 불일치: AI 합계 ${res.total} ≠ 줄 합계 ${res.sum} — 사진과 대조하세요`);
  return res;
}

function resolveNames(it, doc) {
  const parts = it.nameRaw.split('&').map((s) => s.trim()).filter(Boolean);
  const res = parts.slice(0, 2).map((p) => {
    const no = /^#?(\d{1,4})$/.exec(p);
    const m = no ? doc.members.find((x) => +x.no === +no[1]) : doc.members.filter((x) => x.name === p).length === 1 ? doc.members.find((x) => x.name === p) : null;
    if (no && !m) it.warnings.push(`교인번호 ${no[1]} 없음`);
    return m ? { id: m.id, name: m.name } : { id: null, name: no ? '' : p };
  });
  it.memberId = res[0]?.id || null; it.donor = res[0]?.name || '무명';
  it.memberId2 = res[1]?.id || null; it.donor2 = res[1]?.name || '';
}
