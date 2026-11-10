// 지역 모드 — 한국 교회 / 미국 이민교회. 설정에서 고르면 통화·권종·영수증 서식·용어가 함께 바뀐다.
// 첫 거래를 입력한 뒤에는 바꿀 수 없다(저장된 금액 단위가 달라지므로).
import { setCurrency } from './util.js';

export const REGIONS = {
  KR: {
    code: 'KR',
    label: '한국 교회 — 원화(₩) · 국세청 기부금영수증',
    short: '한국',
    currency: 'KRW',
    // 현금 계수 권종 [최소단위 값, 표시]
    bills: [[50000, '5만원'], [10000, '1만원'], [5000, '5천원'], [1000, '1천원'], [500, '500원'], [100, '100원'], [50, '50원'], [10, '10원']],
    orgIdLabel: '고유번호(사업자등록번호)',
    receiptMenu: '기부금영수증',
    personalId: true,   // 주민등록번호 필드 사용(영수증 희망자만)
    lowAmount: 1000,    // 이보다 작으면 '확인' 경고 (최소 단위)
    cashAlert: 500000,  // 고액 현금 지출 경고
    amountHint: '23000 또는 2만3천',
    offerExample: '12 십일조 10만\n홍길동 감사 5만원\n3   ← 주일헌금: 번호만 쓰면 주정 금액 자동\n홍길동 성춘향 부부 감사 10만\n무명 32만 4천원',
    methodLabels: { 현금: '현금', 계좌: '계좌이체', 수표: '수표', 카드: '카드', 기타: '기타' },
  },
  US: {
    code: 'US',
    label: '미국 이민교회 — 달러($) · IRS Contribution Statement',
    short: '미국',
    currency: 'USD',
    bills: [[10000, '$100'], [5000, '$50'], [2000, '$20'], [1000, '$10'], [500, '$5'], [200, '$2'], [100, '$1'], [25, '25¢'], [10, '10¢'], [5, '5¢'], [1, '1¢']],
    orgIdLabel: 'EIN (연방 고용주 식별번호, 선택)',
    receiptMenu: '헌금 영수증 (Contribution Statement)',
    personalId: false,  // 미국 영수증에는 기부자 SSN을 넣지 않는다
    lowAmount: 100,     // $1 미만
    cashAlert: 100000,  // $1,000
    amountHint: '23.50 또는 $23.50',
    offerExample: '12 십일조 150      ← 줄 맨 앞 숫자 = 교인번호, 그 뒤 숫자 = 달러\n#3 감사 $50\n홍길동 감사 100불\n7   ← 번호만 쓰면 주정(매주 약정) 금액 자동\n무명 32.50',
    methodLabels: { 현금: '현금(Cash)', 계좌: '온라인(Zelle·이체)', 수표: '수표(Check)', 카드: '카드', 기타: '기타' },
  },
};

let CUR = REGIONS.KR;
export function setRegion(code) {
  CUR = REGIONS[code] || REGIONS.KR;
  setCurrency(CUR.currency);
  return CUR;
}
export const region = () => CUR;
export const regionOf = (doc) => REGIONS[doc?.settings?.region] || REGIONS.KR;
