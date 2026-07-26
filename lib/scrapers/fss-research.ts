import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';
import { createFssSummaryV2 } from '@/lib/scrapers/fss-summary-v2';

const FSS_RESEARCH_URL = 'https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218';
const FSS_ORGANIZATION = '금융감독원';
const FSS_CATEGORY = '보도자료';
const MAX_PAGE_COUNT = 12;
const BANKING_RELEVANCE_KEYWORDS = [
  '은행', '은행권', '은행업', '은행대리업', '인터넷전문은행', '예금', '대출', '여신', '수신', '지급결제',
  '결제', '자산관리', '가계대출', '기업대출', '기업금융', '신용대출', '주택담보', '은행 규제',
  '정책금융', '생산적 금융', '국민성장펀드', '기술투자', '벤처금융', '벤처기업', '자금조달', '혁신 프리미어',
];
const INDUSTRY_WIDE_KEYWORDS = [
  '디지털금융', '전자금융', '금융플랫폼', '금융 플랫폼', '금융데이터', '금융 데이터', '마이데이터',
  '인공지능', 'ai', '금융소비자보호', '금융소비자 보호', '금융소비자', '금융회사', '금융산업', '금융권', '건전성',
  '유동성', '감독규정', '금융규제', '규제 개선', '제도 개선', '금융서비스', '금융 서비스', '생산적 금융',
  '디지털 전환', '금융혁신', 'ai 금융', '금융안정', '금융상황', '공적자금', 'pg', '가맹점', '소비자보호 제도',
];
const SECTOR_SPECIFIC_EXCLUSION_KEYWORDS = ['보험업', '보험사', '보험회사', '증권업', '증권사', '금융투자업', '자본시장', '펀드', '선물'];
const GENERAL_GUIDE_EXCLUSION_KEYWORDS = ['보이스피싱', '금융사기', '피해 예방', '소비자 유의', '유의사항', '캠페인', '안내', '인사', '채용'];

function normalizeUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://www.fss.or.kr${url.startsWith('/') ? '' : '/'}${url}`;
}

function parseDateValue(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\s+/g, ' ');
  const isoMatch = normalized.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const koreanMatch = normalized.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (koreanMatch) {
    const [, year, month, day] = koreanMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function formatDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, ' ').trim();
}

function getPageUrl(page: number): string {
  return page === 1 ? FSS_RESEARCH_URL : `${FSS_RESEARCH_URL}&pageIndex=${page}`;
}

function shouldIncludeReport(report: Report): boolean {
  const title = report.title.toLowerCase();
  return !GENERAL_GUIDE_EXCLUSION_KEYWORDS.some((keyword) => title.includes(keyword.toLowerCase()));
}

function isWithinLastMonth(publishedAt: string): boolean {
  const date = parseDateValue(publishedAt);
  if (!date) return false;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 14);
  startDate.setHours(0, 0, 0, 0);

  return date >= startDate && date <= now;
}

function hasOlderReport(reports: Report[]): boolean {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 14);
  startDate.setHours(0, 0, 0, 0);

  return reports.some((report) => {
    const date = parseDateValue(report.publishedAt);
    return date !== null && date < startDate;
  });
}

type FssSentenceRole = 'background' | 'event' | 'result' | 'statistics' | 'problem' | 'other';

interface FssSentence {
  text: string;
  index: number;
  role: FssSentenceRole;
  roleReason: string;
  score: number;
}

const FSS_LIST_MARKERS = /[ㅁ□○ㅇ■●◇◆▪▶•]/g;
const FSS_RESULT_KEYWORDS = ['개선', '확대', '축소', '완화', '강화', '개정', '시행', '의결', '지정', '도입', '지원', '추진', '출범', '구축', '변경', '적용', '마련', '논의', '점검', '체결', '증가', '감소', '상승', '하락', '전환', '조정', '정비', '보호', '차단', '피해구제'];
const FSS_ACTION_RESULT_PATTERNS = [
  /기준.*개선|인정 범위.*확대|제외 대상.*(?:축소|정비)|산정방식.*변경|절차.*간소화/,
  /규정.*개정|적용 대상.*확대|보호장치.*강화|대응체계.*구축|탐지.*차단.*강화/,
  /피해구제.*절차.*마련|지원.*확대|점검.*지시|시행 예정|도입|의결|지정/,
];
const FSS_PROBLEM_KEYWORDS = ['민원 발생', '민원이 빈번', '불편 발생', '애로사항', '부담 증가', '어려움', '문제점', '미흡', '취약', '우려', '위험 확대', '피해 발생', '혼선', '한계', '제약', '부작용'];
const FSS_STATISTICS_KEYWORDS = ['금액', '비율', '퍼센트', '조원', '억원', '만원', 'bp', '건수', '전월', '전년', '증가폭', '감소폭', '회수율'];
const FSS_EXCLUDED_PATTERNS = [/문의/, /담당/, /붙임/, /첨부/, /홈페이지/, /관련 국정과제/, /자세한 내용/, /보도자료/, /전화번호/, /이메일/];
const FSS_BACKGROUND_PATTERNS = [/^(?:금융감독원|금융위원회|은행)(?:은|는|이|가)/, /^이번\s*(?:회의|간담회|협약|설명회)(?:는|은)/, /(?:목적|취지|배경)(?:으로|은|는)/, /(?:위해|위한).*(?:마련됐|마련되었)/];
const FSS_EVENT_KEYWORDS = ['개최', '참석', '실시', '회의', '간담회', '설명회', '공청회', '협약', '업무협약', '출범식', '정책회의'];

function logFssSummary(label: string, value: unknown): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(label, value);
  }
}

function normalizeFssSentence(value: string): string {
  const text = value
    .replace(/^\s*(?:[ㅁ□○ㅇ■●◇◆▪▶•]|[-–—]+|\d{1,3}[.)]|[①-⑳]|[（(]\d{1,3}[)）])\s*/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/증가하여/g, '증가해')
    .replace(/전월 대비/g, '전월보다')
    .replace(/전년 동월 대비/g, '전년 동월보다')
    .replace(/기업들의/g, '기업의')
    .replace(/기대됩니다/g, '기대된다')
    .replace(/기대$/g, '기대된다')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return `${text.replace(/[.!?。]+$/g, '').trim()}.`;
}

function splitFssSentences(content: string): string[] {
  const trimmedContent = content
    .split(/문의처?|담당(?:부서|자)?|연락처|붙임|별첨|첨부파일?/)[0]
    .split(/※\s*자세한 내용은/)[0]
    .replace(/조회수\s*[:：]?\s*\d+/g, ' ')
    .replace(/(?:페이지|page)\s*\d+/gi, ' ')
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(FSS_LIST_MARKERS, '\n');
  const protectedDecimals = trimmedContent.replace(/(\d)\.(\d)/g, '$1∯$2');

  return protectedDecimals
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => normalizeFssSentence(sentence.replace(/∯/g, '.')))
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 250);
}

function getFssSentenceRole(sentence: string): Pick<FssSentence, 'role' | 'roleReason'> {
  const hasDirectStatistic = FSS_STATISTICS_KEYWORDS.some((keyword) => sentence.includes(keyword))
    || /\d+(?:\.\d+)?\s*(?:조원|억원|만원|%|bp|명|건)/.test(sentence);
  const hasResult = FSS_RESULT_KEYWORDS.some((keyword) => sentence.includes(keyword));
  const actionPattern = FSS_ACTION_RESULT_PATTERNS.find((pattern) => pattern.test(sentence));
  const problemKeyword = FSS_PROBLEM_KEYWORDS.find((keyword) => sentence.includes(keyword));
  const isPurposeOnly = /(?:논의|개선|점검).*(?:하기 위해|을 위해).*(?:마련됐|마련되었)/.test(sentence);

  if (isPurposeOnly) return { role: 'background', roleReason: '조치 목적 설명' };

  if (actionPattern) return { role: 'result', roleReason: `실제 조치 ${actionPattern}` };

  if (problemKeyword) return { role: 'problem', roleReason: `문제·현상 ${problemKeyword}` };
  if (hasDirectStatistic) return { role: 'statistics', roleReason: hasResult ? '수치와 변화 표현 동시 포함' : '수치 표현' };

  if (hasResult && /(?:개선|확대|축소|완화|강화|개정|시행|의결|지정|도입|지원|추진|출범|구축|변경|적용|마련|논의|점검|체결|정비|보호|차단|피해구제)/.test(sentence)) {
    return { role: 'result', roleReason: '실제 조치 또는 제도 변화' };
  }

  const backgroundPattern = FSS_BACKGROUND_PATTERNS.find((pattern) => pattern.test(sentence));
  if (backgroundPattern) return { role: 'background', roleReason: `배경 문장 형식 ${backgroundPattern}` };

  const statisticsKeyword = FSS_STATISTICS_KEYWORDS.find((keyword) => sentence.includes(keyword));
  if (statisticsKeyword || /\d+(?:\.\d+)?\s*(?:조원|억원|만원|%|bp|명|건)/.test(sentence)) {
    return { role: 'statistics', roleReason: statisticsKeyword || '수치 표현' };
  }

  const resultKeyword = FSS_RESULT_KEYWORDS.find((keyword) => sentence.includes(keyword));
  if (resultKeyword) return { role: 'result', roleReason: resultKeyword };

  const eventKeyword = FSS_EVENT_KEYWORDS.find((keyword) => sentence.includes(keyword));
  if (eventKeyword) return { role: 'event', roleReason: eventKeyword };
  return { role: 'other', roleReason: '핵심 역할 키워드 없음' };
}

function isComplementaryResult(first: FssSentence, candidate: FssSentence, title: string): boolean {
  if (candidate.role !== 'result' || isSimilarFssSentence(first.text, candidate.text) || isTitleDuplicate(candidate.text, title)) {
    return false;
  }

  const firstPhrase = toFssNounPhrase(first.text);
  const candidatePhrase = toFssNounPhrase(candidate.text);
  if (!firstPhrase || !candidatePhrase || `${firstPhrase}, ${candidatePhrase}`.length > 100) return false;

  const ignoredTerms = new Set(['금융감독원', '금융회사', '금융소비자', '금융', '관련', '통해', '위한', '대한']);
  const firstTerms = first.text.split(/[^가-힣0-9]+/).filter((term) => term.length >= 2 && !ignoredTerms.has(term));
  const candidateTerms = candidate.text.split(/[^가-힣0-9]+/).filter((term) => term.length >= 2 && !ignoredTerms.has(term));
  return candidateTerms.some((term) => firstTerms.includes(term));
}

function normalizedFssText(value: string): string {
  return value.replace(/[^가-힣0-9a-z]/gi, '').toLowerCase();
}

function isSimilarFssSentence(left: string, right: string): boolean {
  const normalizedLeft = normalizedFssText(left);
  const normalizedRight = normalizedFssText(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function isTitleDuplicate(sentence: string, title: string): boolean {
  const normalizedSentence = normalizedFssText(sentence);
  const normalizedTitle = normalizedFssText(title);
  if (!normalizedSentence || !normalizedTitle) return false;
  if (normalizedSentence.includes(normalizedTitle) || normalizedTitle.includes(normalizedSentence)) return true;

  const titleTerms = title.split(/\s+/).filter((term) => term.length >= 2);
  const matchedTerms = titleTerms.filter((term) => sentence.includes(term)).length;
  return titleTerms.length >= 2 && matchedTerms / titleTerms.length >= 0.7;
}

function scoreFssSentence(sentence: string, index: number, titleTerms: string[], normalizedTitle: string): number {
  if (FSS_EXCLUDED_PATTERNS.some((pattern) => pattern.test(sentence))) return Number.NEGATIVE_INFINITY;
  const normalizedSentence = normalizedFssText(sentence);
  if (!normalizedSentence || isTitleDuplicate(sentence, titleTerms.join(' '))) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = index < 5 ? 1 : 0;
  if (/\d/.test(sentence)) score += 2;
  if (/\d+(?:\.\d+)?\s*(?:조원|억원|만원|%|bp|명|건)/.test(sentence)) score += 4;
  FSS_RESULT_KEYWORDS.forEach((keyword) => {
    if (sentence.includes(keyword)) score += 2;
  });
  if (FSS_ACTION_RESULT_PATTERNS.some((pattern) => pattern.test(sentence))) score += 4;
  FSS_STATISTICS_KEYWORDS.forEach((keyword) => {
    if (sentence.includes(keyword)) score += 1;
  });
  score -= Math.floor(sentence.length / 90);
  if (normalizedTitle && normalizedSentence.includes(normalizedTitle)) return Number.NEGATIVE_INFINITY;
  return score;
}

function rewriteFssSentence(sentence: string): string {
  const rewritten = sentence
    .replace(/["'‘]?(?:\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})\.?\s*(?:\([^)]+\))?(?:\s*\d{1,2}(?::\d{2})?\s*시)?/g, '$1월 $2일')
    .replace(/개최하였음/g, '개최했다')
    .replace(/실시하였음/g, '실시했다')
    .replace(/추진하였음/g, '추진했다')
    .replace(/논의하였음/g, '논의했다')
    .replace(/출범하였음/g, '출범했다')
    .replace(/체결하였음/g, '체결했다')
    .replace(/마련되었으며/g, '마련됐다')
    .replace(/증가하여/g, '증가해')
    .replace(/감소하여/g, '감소해')
    .replace(/전월 대비/g, '전월보다')
    .replace(/전년 동월 대비/g, '전년 동월보다')
    .replace(/기업들의/g, '기업의')
    .replace(/기대됩니다/g, '기대된다')
    .replace(/([가-힣0-9·,\s]+?) 등이 참석한 가운데/g, '$1 등이 참석해')
    .replace(/참석한 가운데/g, '참석해')
    .replace(/\s*있었으며|\s*있었음|\s*하게 되었음/g, '')
    .replace(/(?:이를 통해|금번)\s*/g, '')
    .replace(/^이번\s*(?:간담회|회의|협약|설명회)는\s*/g, '')
    .replace(/\s*하기 위해 마련됐(?:다|으며)?/g, '')
    .replace(/직접\s*/g, '')
    .replace(/하고,\s*/g, ', ')
    .replace(/주재로(?=\s+(?!열린))/g, '주재로 열린')
    .replace(/기대(?=[.!?。]*$)/g, '기대된다')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .trim();

  const meetingMatch = rewritten.match(/^(금융감독원은)\s+(\d{1,2}월\s+\d{1,2}일)\s+.*?(금융소비자[^.]*?간담회)(?:를|을)\s+개최했다\.$/);
  if (meetingMatch) {
    const [, subject, date, meeting] = meetingMatch;
    return `${subject} ${date} ${meeting}를 개최했다.`;
  }

  return `${rewritten.replace(/[.!?。]+$/g, '').trim()}.`;
}

function toFssNounPhrase(sentence: string): string {
  return rewriteFssSentence(sentence)
    .replace(/^금융감독원은\s+/, '')
    .replace(/\b\d{1,2}월\s+\d{1,2}일\s*/g, '')
    .replace(/["'‘]?\d{2,4}\.(\d{1,2})월\s*/g, '$1월 ')
    .replace(/개최했다\.$/, '개최')
    .replace(/실시했다\.$/, '실시')
    .replace(/추진했다\.$/, '추진')
    .replace(/논의했다\.$/, '논의')
    .replace(/마련됐다\.$/, '마련')
    .replace(/기대된다\.$/, '기대')
    .replace(/시행됐다\.$/, '시행')
    .replace(/발표됐다\.$/, '발표')
    .replace(/증가했다\.$/, '증가')
    .replace(/감소했다\.$/, '감소')
    .replace(/출범했다\.$/, '출범')
    .replace(/체결했다\.$/, '체결')
    .replace(/발생하고 있어\.$/, '발생')
    .replace(/[.!?。]+$/g, '')
    .replace(/^[,，\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rewriteFssSummary(sentences: FssSentence[]): string {
  const phrases = sentences
    .map((sentence) => toFssNounPhrase(sentence.text))
    .filter((sentence, index, values) => sentence.length > 1 && values.indexOf(sentence) === index);
  const selected: string[] = [];

  for (const phrase of phrases) {
    const next = [...selected, phrase].join(', ');
    if (next.length > 100 && selected.length > 0) continue;
    if (next.length > 100) continue;
    selected.push(phrase);
  }

  return selected.join(', ');
}

function createFssContentFallbackSummary(content: string, title: string): string {
  const fallbackSentence = splitFssSentences(content).find((sentence) => (
    !FSS_EXCLUDED_PATTERNS.some((pattern) => pattern.test(sentence))
    && !isTitleDuplicate(sentence, title)
  ));

  return fallbackSentence ? toFssNounPhrase(fallbackSentence) : '';
}

function createFssRuleBasedSummary(content: string, title: string): string {
  const normalizedTitle = normalizedFssText(title);
  const titleTerms = title.split(/\s+/).filter((term) => term.length >= 2 && /[가-힣a-z]/i.test(term));
  const candidates = splitFssSentences(content)
    .map((text, index) => {
      const { role, roleReason } = getFssSentenceRole(text);
      const score = scoreFssSentence(text, index, titleTerms, normalizedTitle);
      const candidate = { text, index, role, roleReason, score } satisfies FssSentence;
      logFssSummary('[FSS sentence]', { title, sentence: text });
      logFssSummary('[FSS role]', { title, role });
      logFssSummary('[FSS role reason]', { title, reason: roleReason });
      return candidate;
    })
    .filter((sentence) => Number.isFinite(sentence.score));

  const groups: Record<FssSentenceRole, FssSentence[]> = {
    result: [],
    statistics: [],
    problem: [],
    event: [],
    background: [],
    other: [],
  };
  candidates.forEach((candidate) => groups[candidate.role].push(candidate));
  (Object.keys(groups) as FssSentenceRole[]).forEach((role) => {
    groups[role].sort((left, right) => right.score - left.score || left.index - right.index);
    logFssSummary('[FSS candidate group]', { title, role, candidates: groups[role].map((item) => ({ text: item.text, score: item.score })) });
  });

  const selected: FssSentence[] = [];
  const addCandidate = (candidate: FssSentence | undefined) => {
    if (candidate && !selected.some((item) => isSimilarFssSentence(item.text, candidate.text))) selected.push(candidate);
  };
  addCandidate(groups.result[0]);
  if (selected.length === 0) addCandidate(groups.statistics[0]);
  if (selected.length === 0) addCandidate(groups.problem[0]);
  if (selected.length === 0) addCandidate(groups.event[0]);
  if (selected.length === 0) addCandidate(groups.background[0]);

  if (selected.length === 1 && selected[0].role === 'result') {
    const complementaryResult = groups.result.find((candidate) => isComplementaryResult(selected[0], candidate, title));
    addCandidate(complementaryResult);
  }

  const summaryBeforeRewrite = selected
    .map((sentence) => sentence.text)
    .join(' ');
  logFssSummary('[FSS selected before rewrite]', { title, summary: summaryBeforeRewrite, roles: selected.map((item) => item.role) });

  const summary = selected.length === 0
    ? createFssContentFallbackSummary(content, title)
    : rewriteFssSummary(selected) || createFssContentFallbackSummary(content, title);
  logFssSummary('[FSS selected after rewrite]', { title, summary });
  return summary;
}

async function fetchSummary(url: string, title: string): Promise<string> {
  try {
    const html = await fetchHtml(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const document = new JSDOM(html).window.document;
    const content = ['main .dbdata', 'main .view-content', 'main .board-view', 'main .bbs-view', 'main .view_cont', 'main .contents', 'main article']
      .map((selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '')
      .sort((left, right) => right.length - left.length)[0] || '';
    logFssSummary('[FSS title]', title);
    logFssSummary('[FSS detail content]', { title, contentLength: content.length });

    const oldSummary = createFssRuleBasedSummary(content, title);
    const newSummary = createFssSummaryV2(content, title);
    logFssSummary('[FSS summary comparison]', { title, oldSummary, newSummary });

    return process.env.FSS_SUMMARY_VERSION === 'v2' ? newSummary : oldSummary;
  } catch (error) {
    logFssSummary('[FSS detail fetch failed]', {
      title,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

export async function fetchFssResearchReports(): Promise<Report[]> {
  try {
    logFssSummary('[FSS scraper called]', { organization: FSS_ORGANIZATION });
    const reportsByUrl = new Map<string, Report>();

    for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
      const html = await fetchHtml(getPageUrl(page), {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        cache: 'no-store',
      });
      const dom = new JSDOM(html);
      const document = dom.window.document;
      const titleLinks = Array.from(document.querySelectorAll('tbody td.title a[href]')).filter((link) => {
        const href = link.getAttribute('href') || '';
        return href.includes('/fss/bbs/B0000188/view.do');
      });
      const pageReports = titleLinks
        .map((link) => {
        const row = link.closest('tr');
        if (!row) return null;

        const href = link.getAttribute('href') || '';
        const title = link.textContent?.trim() || '';
        const rowText = row.textContent || '';
        const dateMatch = rowText.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/);
        const rawPublishedAt = dateMatch?.[0] || '';
        const publishedAt = formatDate(rawPublishedAt);

        if (!title || !publishedAt || !href) {
          return null;
        }

        const idMatch = href.match(/(?:nttId|newsDataSlno|no|seqNo|bbsNo)=?(\d+)/i) || href.match(/(\d+)(?:\.do)?$/);
        const id = idMatch ? Number.parseInt(idMatch[1], 10) : 0;

        return {
          id,
          title,
          summary: '',
          organization: FSS_ORGANIZATION,
          category: FSS_CATEGORY,
          publishedAt,
          url: normalizeUrl(href),
          } satisfies Report;
        })
        .filter((report): report is NonNullable<typeof report> => report !== null);

      if (pageReports.length === 0) break;

      pageReports.forEach((report) => reportsByUrl.set(report.url, report));
      if (process.env.NODE_ENV === 'development') {
        const recentCount = Array.from(reportsByUrl.values()).filter((report) => isWithinLastMonth(report.publishedAt)).length;
        console.info(
          `[${FSS_ORGANIZATION}] page=${page} url=${getPageUrl(page)} parsed=${pageReports.length} first="${pageReports[0]?.title || ''}" lastDate=${pageReports[pageReports.length - 1]?.publishedAt || ''} recentTotal=${recentCount}`,
        );
      }
      if (hasOlderReport(pageReports)) break;
    }

    const reports = Array.from(reportsByUrl.values());
    if (reports.length === 0) {
      throw new Error('No reports parsed from FSS page');
    }

    const sortedReports = reports
      .filter((report) => {
        return isWithinLastMonth(report.publishedAt);
      })
      .sort((left, right) => {
        const leftDate = parseDateValue(left.publishedAt);
        const rightDate = parseDateValue(right.publishedAt);

        if (leftDate && rightDate) {
          return rightDate.getTime() - leftDate.getTime();
        }

        return 0;
      });

    const includedReports = sortedReports.filter(shouldIncludeReport);
    if (process.env.NODE_ENV === 'development') {
      console.info(
        `[${FSS_ORGANIZATION}] deduplicated=${reports.length} recentTotal=${sortedReports.length} includedTotal=${includedReports.length}`,
      );
    }
    const displayedReports = includedReports.length > 0 ? includedReports : sortedReports;
    return displayedReports;
  } catch (error) {
    console.error('FSS research fetch failed:', error);
    return [];
  }
}
