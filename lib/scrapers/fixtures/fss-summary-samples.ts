import { createFssSummaryV2 } from '@/lib/scrapers/fss-summary-v2';

export interface FssSummarySample {
  title: string;
  content: string;
}

export const fssSummarySamples: FssSummarySample[] = [
  {
    title: '앞으로 은행에서 대출금리를 감면받기 더 편해집니다.',
    content: '은행은 가계대출시 급여이체, 적금가입, 카드이용 등을 조건으로 금리를 감면해 주고 있습니다. 그러나 상기 금리감면 조건 중 카드이용실적 산정방식 및 실적 제외대상 등과 관련한 민원이 빈번히 발생하고 있어.',
  },
  {
    title: '금감원, 금융상황 점검회의 개최',
    content: '금융감독원은 금융상황 점검회의를 개최하여 기준금리 인상에 따른 금융시장 동향 및 대내외 리스크 요인을 점검하였음. 기업 자금조달 여건 악화와 취약차주 금리 부담 상승 등 리스크 요인들을 면밀히 점검할 것을 지시하였음.',
  },
  {
    title: '금융소비자 현장 목소리 청취 간담회 개최',
    content: '이번 간담회는 소비자가 실생활에서 겪는 불편과 애로사항을 청취하고 소비자보호 감독 및 제도개선 방향을 논의하기 위해 마련되었음. 장애인과 고령자의 금융접근성 제고, 금융상품 설명방식 개선, 금융교육 확대 등 소비자보호 현안에 대한 의견이 제시되었음.',
  },
  {
    title: '금융회사 임직원의 금융소비자보호 역량 강화를 위한 업무협약 체결',
    content: '금융소비자보호 역량 강화 협력을 은행권 외 주요 금융권역으로 확대하기 위해 협약을 마련하였음. 금융회사 임직원 교육을 통해 전문성을 강화하고 업무 전 과정에 소비자보호 가치를 내재화할 계획임.',
  },
  {
    title: 'PG사의 부정결제 예방, 대응체계 강화를 통해 온라인 결제의 신뢰성과 안전성을 높이겠습니다',
    content: '금융감독원과 한국핀테크산업협회는 주요 PG사와 보안 전문가가 참여하는 온라인 부정결제 대응협의체를 출범하였음. 개인정보 탈취 등에 의한 부정결제가 증가함에 따라 결제 안정성을 높이고 이용자 보호 방안을 모색하기로 함.',
  },
  {
    title: '2026년 6월 가계대출 동향(잠정) 및 가계부채 점검회의 개최',
    content: '26.6월 전 금융권 가계대출은 8.3조원 증가해 전월 9.3조원 대비 증가폭 축소, 전년 동월 6.5조원 대비 증가폭 확대. 사내대출은 근저당권 설정과 원리금 분할상환 등을 중심으로 자율적 관리 노력 확산 기대.',
  },
  {
    title: '중소·벤처기업의 자금조달 절차 완화를 위한 자본시장법 시행령·감독규정 개정',
    content: '소액공모 범위 확대: 기존 10억원 미만에서 개선 30억원 미만. 증권신고서 대신 소액공모서류 공시만으로 신속한 자금조달이 가능하도록 시행령 개정 및 시행 예정.',
  },
];

export function compareFssSummarySamples(createV1: (content: string, title: string) => string) {
  return fssSummarySamples.map(({ title, content }) => ({
    title,
    oldSummary: createV1(content, title),
    newSummary: createFssSummaryV2(content, title),
  }));
}
