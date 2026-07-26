import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';
import { createRuleBasedSummary } from '@/lib/utils/rule-based-summary';

const FSC_RESEARCH_URL = 'https://www.fsc.go.kr/no010101';
const FSC_ORGANIZATION = '금융위원회';
const FSC_CATEGORY = '보도자료';
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

const SECTOR_SPECIFIC_EXCLUSION_KEYWORDS = [];

const GENERAL_GUIDE_EXCLUSION_KEYWORDS = [
  '인사발령',
  '채용',
  '채용공고',
  '입찰',
  '공모전',
  '시상식',
  '수상',
  '축사',
  '기념사',
  '환영사',
  '행사 개최',
  '행사 안내',
  '캠페인',
  '홍보',
  '가입 신청자',
  '누적 신청자',
  '신청 마감',
  '신청 일정',
  '가입절차',
  'FAQ',
  '자주 묻는 질문',
];

function normalizeUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://www.fsc.go.kr${url.startsWith('/') ? '' : '/'}${url}`;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const dateMatch = trimmed.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/);
  return dateMatch?.[0] || trimmed;
}

function getPageUrl(page: number): string {
  return page === 1 ? FSC_RESEARCH_URL : `${FSC_RESEARCH_URL}?curPage=${page}`;
}

function shouldIncludeReport(report: Report): boolean {
  const title = report.title.toLowerCase();
  return !GENERAL_GUIDE_EXCLUSION_KEYWORDS.some((keyword) => title.includes(keyword.toLowerCase()));
}

function isWithinLastMonth(publishedAt: string): boolean {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return false;

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
    const date = new Date(report.publishedAt);
    return !Number.isNaN(date.getTime()) && date < startDate;
  });
}

async function fetchSummary(url: string, title: string): Promise<string> {
  try {
    const html = await fetchHtml(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 60 * 60 } });
    const document = new JSDOM(html).window.document;
    const content = ['main .content-body', 'main .view-content', 'main .board-view', 'main .bbs-view', 'main article']
      .map((selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '')
      .find((text) => text.length > 80) || '';
    return createRuleBasedSummary(content, title);
  } catch {
    return createRuleBasedSummary('', title);
  }
}

export async function fetchFscResearchReports(): Promise<Report[]> {
  try {
    const reportsByUrl = new Map<string, Report>();

    for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
      const html = await fetchHtml(getPageUrl(page), {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        next: { revalidate: 60 * 60 },
      });
      const dom = new JSDOM(html);
      const document = dom.window.document;
      const scope = document.querySelector('main') || document.body;
      const items = Array.from(scope.querySelectorAll('li'));
      const pageReports = items
        .map((item) => {
        const titleElement = Array.from(item.querySelectorAll('a[href]')).find((anchor) => {
          const href = anchor.getAttribute('href') || '';
          return href.includes('/no010101/') || href.includes('no010101') || href.includes('view.do');
        });
        const title = titleElement?.textContent?.trim() || '';
        const textContent = item.textContent || '';
        const publishedAt = parseDate(textContent.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/)?.[0] || '');
        const href = titleElement?.getAttribute('href') || '';

        if (!title || !publishedAt || !href) {
          return null;
        }

        const rawTitle = title.replace(/금일 등록된 게시글/g, '').trim();
        const idMatch = href.match(/(\/no010101\/\d+)/);
        const id = idMatch ? Number.parseInt(idMatch[1].split('/').pop() || '0', 10) : 0;

        return {
          id,
          title: rawTitle,
          summary: '',
          organization: FSC_ORGANIZATION,
          category: FSC_CATEGORY,
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
          `[${FSC_ORGANIZATION}] page=${page} url=${getPageUrl(page)} parsed=${pageReports.length} first="${pageReports[0]?.title || ''}" lastDate=${pageReports[pageReports.length - 1]?.publishedAt || ''} recentTotal=${recentCount}`,
        );
      }
      if (hasOlderReport(pageReports)) break;
    }

    const reports = Array.from(reportsByUrl.values());
    if (reports.length === 0) {
      throw new Error('No reports parsed from FSC page');
    }

    const sortedReports = reports.sort((left, right) => {
      const leftDate = new Date(left.publishedAt);
      const rightDate = new Date(right.publishedAt);
      return Number.isNaN(rightDate.getTime()) ? 0 : rightDate.getTime() - leftDate.getTime();
    });

    const recentReports = sortedReports.filter((report) => isWithinLastMonth(report.publishedAt));
    const includedReports = recentReports.filter(shouldIncludeReport);
    if (process.env.NODE_ENV === 'development') {
      console.info(
        `[${FSC_ORGANIZATION}] deduplicated=${reports.length} recentTotal=${recentReports.length} includedTotal=${includedReports.length}`,
      );
    }
    const displayedReports = includedReports.length > 0 ? includedReports : recentReports;
    return displayedReports;
  } catch (error) {
    console.error('FSC research fetch failed:', error);
    return [];
  }
}
