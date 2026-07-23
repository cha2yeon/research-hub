export type FssSentenceType = 'action' | 'statistic' | 'problem' | 'background' | 'other';

interface FssSummarySentence {
  text: string;
  type: FssSentenceType;
  score: number;
}

const ACTION_PATTERNS = [
  /기준.*개선|인정 범위.*확대|제외 대상.*(?:축소|정비)|산정방식.*변경|절차.*간소화/,
  /규정.*개정|적용 대상.*확대|보호장치.*강화|대응체계.*구축|탐지.*차단.*강화/,
  /피해구제.*절차.*마련|지원.*확대|점검.*지시|시행 예정|도입|의결|지정/,
];
const ACTION_KEYWORDS = ['개선', '확대', '변경', '정비', '개정', '시행', '도입', '강화', '구축', '마련', '지원', '지정', '의결', '출범', '점검'];
const STATISTIC_KEYWORDS = ['금액', '비율', '건수', '전월', '전년', '증가폭', '감소폭', '연체율', '조원', '억원', '만원', 'bp'];
const PROBLEM_KEYWORDS = ['민원', '불편', '애로', '부담', '피해', '위험', '혼선', '한계', '미흡', '우려', '취약', '어려움', '문제점', '부작용'];
const EXCLUDED_PATTERNS = [/문의/, /담당/, /붙임/, /첨부/, /홈페이지/, /관련 국정과제/, /자세한 내용/, /보도자료/, /전화번호/, /이메일/];
const LIST_MARKERS = /[ㅁ□○ㅇ■●◇◆▪▶•]/g;

function normalize(value: string): string {
  return value.replace(/[^가-힣0-9a-z]/gi, '').toLowerCase();
}

function normalizeSentence(value: string): string {
  return value
    .replace(/^\s*(?:[ㅁ□○ㅇ■●◇◆▪▶•]|[-–—]+|\d{1,3}[.)]|[①-⑳]|[（(]\d{1,3}[)）])\s*/g, '')
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?。]+$/g, '')
    .trim();
}

function splitSentences(content: string): string[] {
  const cleaned = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|quot|lt|gt);/gi, ' ')
    .split(/문의처?|담당(?:부서|자)?|연락처|붙임|별첨|첨부파일?|※\s*자세한 내용은/)[0]
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(LIST_MARKERS, '\n')
    .replace(/(\d)\.(\d)/g, '$1∯$2');

  return cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => normalizeSentence(sentence.replace(/∯/g, '.')))
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 250);
}

function isTitleDuplicate(sentence: string, title: string): boolean {
  const normalizedSentence = normalize(sentence);
  const normalizedTitle = normalize(title);
  if (!normalizedSentence || !normalizedTitle) return false;
  if (normalizedSentence.includes(normalizedTitle) || normalizedTitle.includes(normalizedSentence)) return true;

  const titleTerms = title.split(/\s+/).filter((term) => term.length >= 2);
  const matched = titleTerms.filter((term) => sentence.includes(term)).length;
  return titleTerms.length >= 3 && matched / titleTerms.length >= 0.8;
}

function classify(sentence: string): FssSentenceType {
  const hasNumber = /\d+(?:\.\d+)?\s*(?:조원|억원|만원|%|bp|명|건)/.test(sentence);
  const hasStatistic = hasNumber || STATISTIC_KEYWORDS.some((keyword) => sentence.includes(keyword));
  const hasAction = ACTION_PATTERNS.some((pattern) => pattern.test(sentence))
    || ACTION_KEYWORDS.some((keyword) => sentence.includes(keyword));
  const hasProblem = PROBLEM_KEYWORDS.some((keyword) => sentence.includes(keyword));
  const isPurposeOnly = /(?:논의|개선|점검).*(?:하기 위해|을 위해).*(?:마련됐|마련되었)/.test(sentence);
  const isEvent = /(?:개최|간담회|회의|설명회|참석)/.test(sentence);
  const hasStrongAction = ACTION_PATTERNS.some((pattern) => pattern.test(sentence)) && !/모색하기로|방안을 모색/.test(sentence);

  if (isPurposeOnly) return 'background';
  if (hasStrongAction) return 'action';
  if (hasStatistic) return 'statistic';
  if (hasProblem) return 'problem';
  if (isEvent || /^(?:금융감독원|금융위원회|은행)(?:은|는|이|가)|(?:목적|취지|배경)/.test(sentence)) return 'background';
  if (hasAction) return 'action';
  return 'other';
}

function score(sentence: string, type: FssSentenceType, title: string): number {
  let value = 0;
  if (/\d/.test(sentence)) value += 2;
  if (/\d+(?:\.\d+)?\s*(?:조원|억원|만원|%|bp|명|건)/.test(sentence)) value += 3;
  if (STATISTIC_KEYWORDS.some((keyword) => sentence.includes(keyword))) value += 2;
  if (ACTION_PATTERNS.some((pattern) => pattern.test(sentence))) value += 4;
  if (type === 'action') value += 2;
  if (type === 'background') value -= 2;

  const titleTerms = title.split(/\s+/).filter((term) => term.length >= 2);
  value += titleTerms.filter((term) => sentence.includes(term)).length;
  value -= Math.floor(sentence.length / 100);
  return value;
}

function toNounPhrase(sentence: string): string {
  return sentence
    .replace(/^금융감독원(?:과|은|이|가)?\s*/, '')
    .replace(/^금융위원회(?:은|는|이|가)?\s*/, '')
    .replace(/^[,，\s]*['‘]?\d{2,4}\.\d{1,2}\.\d{1,2}\.?\s*(?:\([^)]+\))?\s*,?\s*/g, '')
    .replace(/['‘]?\d{2,4}\.(\d{1,2})(?:\.(\d{1,2})|월(?:말|중)?)\.?\s*(?:\([^)]+\))?(?:\s*\d{1,2}(?::\d{2})?시)?\s*/g, '')
    .replace(/['‘]?\d{2}\.(?:상반기|하반기)\s*중?\s*/g, '')
    .replace(/^금융감독원(?:과|은|는|이|가)?\s*/, '')
    .replace(/^금융위원회(?:은|는|이|가)?\s*/, '')
    .replace(/^\d{1,2}월\s*\d{1,2}일\s*/g, '')
    .replace(/^이번\s*(?:간담회|회의|협약|설명회)(?:는|은)\s*/g, '')
    .replace(/(?:개최|실시|추진|논의|출범|체결)하였음$/g, (word) => word.replace(/하였음$/, ''))
    .replace(/(?:개최|실시|추진|논의|출범|체결)했다$/g, (word) => word.replace(/했다$/, ''))
    .replace(/예정입니다$/g, '예정')
    .replace(/계획입니다$/g, '계획')
    .replace(/(?:입니다|됩니다|하였습니다|하였음|되었음|되었다)$/g, '')
    .replace(/(?:증가|감소)하여/g, (word) => word.replace('하여', '해'))
    .replace(/전월 대비/g, '전월보다')
    .replace(/전년 동월 대비/g, '전년 동월보다')
    .replace(/\s+/g, ' ')
    .replace(/^[,，\s]+/g, '')
    .replace(/[,.，\s]+$/g, '')
    .trim();
}

function canAddSecond(first: FssSummarySentence, next: FssSummarySentence): boolean {
  if (first.type !== 'action' || next.type !== 'action') return false;
  const firstTerms = first.text.split(/[^가-힣0-9]+/).filter((term) => term.length >= 2);
  const nextTerms = next.text.split(/[^가-힣0-9]+/).filter((term) => term.length >= 2);
  return nextTerms.some((term) => firstTerms.includes(term));
}

export function createFssSummaryV2(content: string, title: string): string {
  const groups: Record<FssSentenceType, FssSummarySentence[]> = {
    action: [], statistic: [], problem: [], background: [], other: [],
  };

  splitSentences(content).forEach((text) => {
    if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(text)) || isTitleDuplicate(text, title)) return;
    const type = classify(text);
    groups[type].push({ text, type, score: score(text, type, title) });
  });

  (Object.keys(groups) as FssSentenceType[]).forEach((type) => {
    groups[type].sort((left, right) => right.score - left.score || left.text.length - right.text.length);
  });

  const selectWithinGroup = (candidates: FssSummarySentence[]) => candidates.find((candidate) => {
    const phrase = toNounPhrase(candidate.text);
    return phrase.length >= 2 && phrase.length <= 100;
  });
  const first = selectWithinGroup(groups.action)
    || selectWithinGroup(groups.statistic)
    || selectWithinGroup(groups.problem)
    || selectWithinGroup(groups.background);
  if (!first) return '';

  const phrases = [toNounPhrase(first.text)];
  const second = groups.action.find((candidate) => candidate !== first && canAddSecond(first, candidate));
  if (second) {
    const next = toNounPhrase(second.text);
    if (next && `${phrases[0]}, ${next}`.length <= 100) phrases.push(next);
  }

  return phrases.filter(Boolean).join(', ').replace(/[,.，\s]+$/g, '');
}
