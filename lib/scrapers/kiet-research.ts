import { absoluteUrl, fetchDocument, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = 'KIET 산업연구원';
const CATEGORY = '연구보고서';
const RECENT_DAYS = 28;
const MAX_PAGE_COUNT = 10;
const SITE_URL = 'https://www.kiet.re.kr';

type StandardSource = {
  sourceType: 'issueList' | 'reportList' | 'redataList' | 'paperList';
  listUrl: string;
  idParameter: string;
};

type CollectionStats = {
  fetchedPages: number;
  candidates: number;
  titleParsed: number;
  dateParsed: number;
  recentPassed: number;
  summaryParsed: number;
  finalReports: number;
};

const STANDARD_SOURCES: readonly StandardSource[] = [
  { sourceType: 'issueList', listUrl: `${SITE_URL}/research/issueList`, idParameter: 'issue_no' },
  { sourceType: 'reportList', listUrl: `${SITE_URL}/research/reportList`, idParameter: 'report_no' },
  { sourceType: 'redataList', listUrl: `${SITE_URL}/research/redataList`, idParameter: 'redata_no' },
  { sourceType: 'paperList', listUrl: `${SITE_URL}/research/paperList`, idParameter: 'paper_no' },
];

function emptyStats(): CollectionStats {
  return { fetchedPages: 0, candidates: 0, titleParsed: 0, dateParsed: 0, recentPassed: 0, summaryParsed: 0, finalReports: 0 };
}

function createPageUrl(listUrl: string, page: number): string {
  const url = new URL(listUrl);
  url.searchParams.set('pg', String(page));
  url.searchParams.set('pp', '20');
  return url.toString();
}

function cleanOfficialSummary(root: Element, title = ''): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, button, a, .tab, .tabs, .p_d-tab, .file, .attach, .download').forEach((element) => element.remove());

  return (clone.textContent || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/^(?:요약\s*)+(?:언론보도|목차)?\s*/, '')
    .replace(new RegExp(`^${escapeRegExp(title)}\\s*`), '')
    .replace(/(?:원문\s*(?:미리보기|다운로드)|첨부파일|다운로드 안내).*$/, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchOfficialSummary(url: string, title: string): Promise<string> {
  const document = await fetchDocument(ORGANIZATION, url);
  // KIET의 .p_d-cont는 요약·목차·언론보도 탭 전체를 감싼다.
  // 현재 열린 첫 번째 tab_box만 공식 요약 본문이며, 언론보도는 별도 형제 tab_box다.
  const summaryRoot = document.querySelector('.page_view .p_d-cont > .tab_box.open');
  return summaryRoot ? cleanOfficialSummary(summaryRoot, title) : '';
}

async function collectStandardSource(source: StandardSource): Promise<Report[]> {
  const stats = emptyStats();
  const reportsByUrl = new Map<string, Report>();

  try {
    for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
      const document = await fetchDocument(ORGANIZATION, createPageUrl(source.listUrl, page));
      const rows = Array.from(document.querySelectorAll('ul.list_box > li.item'));
      stats.fetchedPages += 1;
      stats.candidates += rows.length;
      if (rows.length === 0) break;

      const parsedDates: string[] = [];
      const recentRows: Array<{ title: string; publishedAt: string; url: string; id: number }> = [];

      rows.forEach((row, index) => {
        const anchor = row.querySelector<HTMLAnchorElement>('.rpt_tit > a[href]');
        const title = normalizeText(anchor?.querySelector('strong')?.textContent || anchor?.textContent);
        const publishedAt = parseDate(normalizeText(row.querySelector('.rpt_tit .date')?.textContent));
        const href = anchor?.getAttribute('href') || '';
        const articleId = href ? new URL(href, source.listUrl).searchParams.get(source.idParameter) : null;

        if (title) stats.titleParsed += 1;
        if (!title || !publishedAt || !href || !articleId) return;

        stats.dateParsed += 1;
        parsedDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS)) return;

        stats.recentPassed += 1;
        recentRows.push({ title, publishedAt, url: absoluteUrl(source.listUrl, href), id: Number(articleId) || index });
      });

      for (const row of recentRows) {
        try {
          const summary = await fetchOfficialSummary(row.url, row.title);
          if (summary) stats.summaryParsed += 1;
          reportsByUrl.set(row.url, {
            id: row.id,
            title: row.title,
            organization: ORGANIZATION,
            category: CATEGORY,
            summary,
            publishedAt: row.publishedAt,
            url: row.url,
          });
        } catch (error) {
          console.error(`[${ORGANIZATION}] ${source.sourceType} summary fetch failed: ${row.url}`, error);
          reportsByUrl.set(row.url, {
            id: row.id,
            title: row.title,
            organization: ORGANIZATION,
            category: CATEGORY,
            publishedAt: row.publishedAt,
            url: row.url,
          });
        }
      }

      // 목록의 일부만 보고 중단하지 않는다. 유효하게 파싱된 모든 날짜가 cutoff 이전일 때만 종료한다.
      if (parsedDates.length > 0 && parsedDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
    }
  } finally {
    stats.finalReports = reportsByUrl.size;
    console.info(`[${ORGANIZATION}] ${source.sourceType} fetchedPages=${stats.fetchedPages} candidates=${stats.candidates} titleParsed=${stats.titleParsed} dateParsed=${stats.dateParsed} recentPassed=${stats.recentPassed} summaryParsed=${stats.summaryParsed} finalReports=${stats.finalReports}`);
  }

  return Array.from(reportsByUrl.values());
}

function parseBriefPublishedAt(value: string): string {
  const match = value.match(/(20\d{2})년\s*(\d{1,2})월/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-01`;
}

function isWithinRecentMonth(publishedAt: string): boolean {
  const [year, month] = publishedAt.split('-').map(Number);
  if (!year || !month) return false;

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return monthEnd >= cutoff && new Date(year, month - 1, 1) <= now;
}

function getBriefId(row: Element): number | null {
  const onclick = row.querySelector('[onclick*="modIndbriefViewCount"]')?.getAttribute('onclick') || '';
  const match = onclick.match(/modIndbriefViewCount\([^,]+,\s*'?(\d+)'?\)/);
  return match ? Number(match[1]) : null;
}

async function collectIndustryBriefs(): Promise<Report[]> {
  const stats = emptyStats();
  const reportsByUrl = new Map<string, Report>();
  const listUrl = `${SITE_URL}/trends/indbriefList`;

  try {
    for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
      const document = await fetchDocument(ORGANIZATION, createPageUrl(listUrl, page));
      const rows = Array.from(document.querySelectorAll('ul.list_box > li.item.detail'));
      stats.fetchedPages += 1;
      stats.candidates += rows.length;
      if (rows.length === 0) break;

      const parsedDates: string[] = [];
      rows.forEach((row) => {
        const title = normalizeText(row.querySelector('.tit .rpt_tit strong')?.textContent);
        const publishedAt = parseBriefPublishedAt(title);
        const id = getBriefId(row);
        if (title) stats.titleParsed += 1;
        if (!title || !publishedAt || !id) return;

        stats.dateParsed += 1;
        parsedDates.push(publishedAt);
        if (!isWithinRecentMonth(publishedAt)) return;

        stats.recentPassed += 1;
        const summary = cleanOfficialSummary(row.querySelector('.detail_box > .list_type04') || row.querySelector('.detail_box') || row, title);
        if (summary) stats.summaryParsed += 1;
        // KIET가 별도 상세 URL을 제공하지 않으므로, 실제 목록 검색 URL을 원문보기 주소로 사용한다.
        const url = new URL(listUrl);
        url.searchParams.set('pg', String(page));
        url.searchParams.set('pp', '20');
        url.searchParams.set('year', publishedAt.slice(0, 4));
        url.searchParams.set('skey', 'A');
        url.searchParams.set('sval', title);
        reportsByUrl.set(url.toString(), {
          id,
          title,
          organization: ORGANIZATION,
          category: CATEGORY,
          summary,
          publishedAt,
          datePrecision: 'month',
          url: url.toString(),
        });
      });

      if (parsedDates.length > 0 && parsedDates.every((date) => !isWithinRecentMonth(date))) break;
    }
  } finally {
    stats.finalReports = reportsByUrl.size;
    console.info(`[${ORGANIZATION}] indbriefList fetchedPages=${stats.fetchedPages} candidates=${stats.candidates} titleParsed=${stats.titleParsed} dateParsed=${stats.dateParsed} recentPassed=${stats.recentPassed} summaryParsed=${stats.summaryParsed} finalReports=${stats.finalReports}`);
  }

  return Array.from(reportsByUrl.values());
}

async function collectEconomy(): Promise<Report[]> {
  const stats = emptyStats();
  const reportsByUrl = new Map<string, Report>();
  const listUrl = `${SITE_URL}/research/economyDetailList?detail_gubun=All`;

  try {
    for (let page = 1; page <= MAX_PAGE_COUNT; page += 1) {
      const document = await fetchDocument(ORGANIZATION, createPageUrl(listUrl, page));
      const rows = Array.from(document.querySelectorAll('ul.list_box > li.item'));
      stats.fetchedPages += 1;
      stats.candidates += rows.length;
      if (rows.length === 0) break;

      const parsedDates: string[] = [];
      const recentRows: Array<{ title: string; publishedAt: string; url: string; id: number }> = [];

      rows.forEach((row, index) => {
        const anchor = row.querySelector<HTMLAnchorElement>('.rpt_tit > a[href*="economyDetailView"]');
        const title = normalizeText(anchor?.querySelector('strong')?.textContent || anchor?.textContent);
        const publishedAt = parseDate(normalizeText(row.querySelector('.rpt_tit .date')?.textContent));
        const href = anchor?.getAttribute('href') || '';
        const id = href ? new URL(href, listUrl).searchParams.get('detail_no') : null;
        if (title) stats.titleParsed += 1;
        if (!title || !publishedAt || !href || !id) return;

        stats.dateParsed += 1;
        parsedDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS)) return;

        stats.recentPassed += 1;
        recentRows.push({ title, publishedAt, url: absoluteUrl(listUrl, href), id: Number(id) || index });
      });

      for (const row of recentRows) {
        try {
          const summary = await fetchOfficialSummary(row.url, row.title);
          if (summary) stats.summaryParsed += 1;
          reportsByUrl.set(row.url, { id: row.id, title: row.title, organization: ORGANIZATION, category: CATEGORY, summary, publishedAt: row.publishedAt, url: row.url });
        } catch (error) {
          console.error(`[${ORGANIZATION}] economy summary fetch failed: ${row.url}`, error);
          reportsByUrl.set(row.url, { id: row.id, title: row.title, organization: ORGANIZATION, category: CATEGORY, publishedAt: row.publishedAt, url: row.url });
        }
      }

      if (parsedDates.length > 0 && parsedDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
    }
  } finally {
    stats.finalReports = reportsByUrl.size;
    console.info(`[${ORGANIZATION}] economy fetchedPages=${stats.fetchedPages} candidates=${stats.candidates} titleParsed=${stats.titleParsed} dateParsed=${stats.dateParsed} recentPassed=${stats.recentPassed} summaryParsed=${stats.summaryParsed} finalReports=${stats.finalReports}`);
  }

  return Array.from(reportsByUrl.values());
}

export async function fetchKietResearchReports(): Promise<Report[]> {
  const tasks = [
    ...STANDARD_SOURCES.map((source) => ({ sourceType: source.sourceType, run: () => collectStandardSource(source) })),
    { sourceType: 'indbriefList', run: collectIndustryBriefs },
    { sourceType: 'economy', run: collectEconomy },
  ];
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  const reportsByUrl = new Map<string, Report>();

  results.forEach((result, index) => {
    const sourceType = tasks[index].sourceType;
    if (result.status === 'rejected') {
      console.error(`[${ORGANIZATION}] ${sourceType} collection failed:`, result.reason);
      return;
    }
    result.value.forEach((report) => reportsByUrl.set(report.url, report));
  });

  const mergedReports = Array.from(reportsByUrl.values());
  const reports = sortReports(mergedReports);
  console.info(`[${ORGANIZATION}] mergedReports=${mergedReports.length} deduplicatedReports=${reports.length}`);
  return reports;
}
