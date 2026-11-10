// 도움말 — 매뉴얼·가이드 문서를 앱 안에서 읽고 인쇄 (오프라인 가능)
import { S, h, $, toast, printHtml } from './ui.js';
import { mdToHtml } from './core/md.js';
import { regionOf } from './core/region.js';

export const DOCS = [
  ['01-빠른시작', '🚀 5분 빠른 시작', '설치 · 첫 설정 · 첫 헌금 입력'],
  ['02-쉬운사용설명서', '📗 그림으로 보는 쉬운 사용설명서', '화면별 따라 하기 (재정 담당자용)'],
  ['03-재정담당자-학습가이드', '🎓 목회자·재정담당자 학습 가이드', '교회 재정 원칙 · 연간 일정 · 점검표'],
  ['04-영수증-가이드-한국-미국', '📄 기부금영수증 가이드 (한국 / 미국)', '국세청 기부금영수증 · IRS Contribution Statement · 공식 링크'],
  ['05-교회-내부-운영규칙', '🏛 교회 내부 운영 규칙(예시)', '역할 분담 · 마감 · 인수인계 · 사고 대응'],
  ['06-AI-활용-가이드', '🤖 무료 AI 활용 가이드', 'Gemini · Claude · ChatGPT 연결, 비용 0으로 쓰기'],
  ['08-한눈요약카드', '🗂 한눈 요약 카드 (인쇄용)', '책상에 붙여 두는 1쪽 요약'],
  ['09-자주묻는질문', '❓ 자주 묻는 질문 · 문제 해결', '비밀번호 분실 · 기기 교체 · 오류'],
];

export function vHelp() {
  const cur = S.ui.helpDoc;
  if (cur) {
    setTimeout(loadDoc, 0);
    const d = DOCS.find((x) => x[0] === cur);
    return h`<div class="row no-print" style="margin-bottom:10px"><button class="btn" data-act="helpBack">← 목록</button><button class="btn" data-act="helpPrint">🖨 인쇄 · PDF</button><span class="muted small">${d ? d[1] : cur}</span></div>
    <div class="card md-body" id="help-body"><p class="muted">불러오는 중…</p></div>`;
  }
  return h`<h2 class="page">도움말 · 교육 자료</h2>
  <p class="muted">지금 설정: <b>${regionOf(S.doc).label}</b>. 모든 문서는 인터넷 없이도 열리고, 인쇄해서 교육 자료로 쓸 수 있습니다.</p>
  <div class="grid">${DOCS.map(([k, t, s]) => h`<button class="card btn-card" data-act="helpOpen" data-doc="${k}"><b>${t}</b><span class="small muted">${s}</span></button>`)}</div>`;
}

async function loadDoc() {
  const el = $('#help-body');
  if (!el) return;
  try {
    const r = await fetch(`docs/${encodeURIComponent(S.ui.helpDoc)}.md`);
    if (!r.ok) throw new Error('문서를 찾을 수 없습니다');
    el.innerHTML = mdToHtml(await r.text(), 'docs/');
    S.ui.helpHtml = el.innerHTML;
    window.scrollTo(0, 0);
  } catch (e) {
    el.innerHTML = '';
    el.textContent = '문서를 불러오지 못했습니다: ' + e.message;
  }
}

export const actions = {
  helpOpen(b) { S.ui.helpDoc = b.dataset.doc; S.view = 'help'; S.render(); },
  helpBack() { S.ui.helpDoc = null; S.render(); },
  helpPrint() { if (!S.ui.helpHtml) return toast('문서를 불러오는 중입니다', true); printHtml(`<article class="doc md-body">${S.ui.helpHtml}</article>`); },
};
export const views = { help: vHelp };
