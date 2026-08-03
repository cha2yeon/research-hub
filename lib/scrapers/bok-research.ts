import { absoluteUrl, fetchDocument, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const KOREA_BANK_LIST_URL = 'https://www.bok.or.kr/portal/singl/newsData/listCont.do';
const ORGANIZATION = '한국은행';
const RECENT_DAYS = 14;
const MAX_PAGE_COUNT = 12;

const LIST_PARAMS = {
  targetDepth: '3',
  menuNo: '201263',
  syncMenuChekKey: '1',
  searchCnd: '1',
  searchKwd: '',
  depth2: '200038',
  depth3: '201263',
  date: '',
  sdate: '',
  edate: '',
  sort: '1',
  pageUnit: '10',
} as const;

function createListUrl(pageIndex: number): string {
  const url = new URL(KOREA_BANK_LIST_URL);
  Object.entries(LIST_PARAMS).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('pageIndex', String(pageIndex));
  return url.toString();
}

export async function fetchKoreaBankReports(): Promise<Report[]> {
  try {
    const reports: Report[] = [];
    let fetchedPages = 0;
    let rawRows = 0;
    let titleParsed = 0;
    let dateParsed = 0;
    let recentPassed = 0;

    for (let pageIndex = 1; pageIndex <= MAX_PAGE_COUNT; pageIndex += 1) {
      const document = await fetchDocument(ORGANIZATION, createListUrl(pageIndex));
      const rows = Array.from(document.querySelectorAll('.bbsRowCls'));
      fetchedPages += 1;
      rawRows += rows.length;

      if (rows.length === 0) break;

      let oldestPublishedAt = '';

      rows.forEach((row, index) => {
        const anchor = row.querySelector<HTMLAnchorElement>('a.title[href]');
        const title = normalizeText(anchor?.textContent);
        const publishedAt = parseDate(normalizeText(row.querySelector('.date')?.textContent));
        const href = anchor?.getAttribute('href') || '';
        const articleId = href.match(/[?&]nttId=(\d+)/)?.[1];
        const category = normalizeText(row.querySelector('.t1')?.textContent) || '보도자료';

        if (title) titleParsed += 1;
        if (publishedAt) {
          dateParsed += 1;
          if (!oldestPublishedAt || publishedAt < oldestPublishedAt) oldestPublishedAt = publishedAt;
        }

        if (!title || !publishedAt || !href || !articleId || !isWithinRecentDays(publishedAt, RECENT_DAYS)) return;

        recentPassed += 1;
        reports.push({
          id: Number(articleId) || index,
          title,
          organization: ORGANIZATION,
          category: category === '보도자료' ? category : '보도자료',
          summary: '',
          publishedAt,
          url: absoluteUrl(KOREA_BANK_LIST_URL, href),
        });
      });

      if (oldestPublishedAt && !isWithinRecentDays(oldestPublishedAt, RECENT_DAYS)) break;
    }

    console.info(
      `[${ORGANIZATION}] fetchedPages=${fetchedPages} rawRows=${rawRows} titleParsed=${titleParsed} dateParsed=${dateParsed} recentPassed=${recentPassed} finalReports=${reports.length}`,
    );
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
