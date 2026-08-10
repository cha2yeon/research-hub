import { absoluteUrl, fetchDocument, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const KOREA_BANK_LIST_URL = 'https://www.bok.or.kr/portal/singl/newsData/listCont.do';
const ORGANIZATION = '한국은행';
const MAX_PAGE_COUNT = 12;

const BOK_LISTS = [
  { name: '보도자료', menuNo: '201263', depth2: '200038', recentDays: 14, category: '보도자료' },
  { name: 'BOK 이슈노트', menuNo: '200433', depth2: '201156', recentDays: 28, category: '연구보고서' },
  { name: 'BOK 경제연구', menuNo: '200431', depth2: '201156', recentDays: 28, category: '연구보고서' },
  { name: '금융안정 조사연구', menuNo: '200327', depth2: '201156', recentDays: 28, category: '연구보고서' },
  { name: '경제전망 핵심이슈·심층연구', menuNo: '201140', depth2: '201156', recentDays: 28, category: '연구보고서' },
] as const;

function createListUrl(pageIndex: number, definition: typeof BOK_LISTS[number]): string {
  const url = new URL(KOREA_BANK_LIST_URL);
  Object.entries({
    targetDepth: '3',
    menuNo: definition.menuNo,
    syncMenuChekKey: '1',
    searchCnd: '1',
    searchKwd: '',
    depth2: definition.depth2,
    depth3: definition.menuNo,
    date: '',
    sdate: '',
    edate: '',
    sort: '1',
    pageUnit: '10',
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('pageIndex', String(pageIndex));
  return url.toString();
}

export async function fetchKoreaBankReports(): Promise<Report[]> {
  try {
    const reports: Report[] = [];
    for (const definition of BOK_LISTS) {
      try {
        let fetchedPages = 0;
        let rawRows = 0;
        let titleParsed = 0;
        let dateParsed = 0;
        let recentPassed = 0;

        for (let pageIndex = 1; pageIndex <= MAX_PAGE_COUNT; pageIndex += 1) {
          const document = await fetchDocument(ORGANIZATION, createListUrl(pageIndex, definition));
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

            if (title) titleParsed += 1;
            if (publishedAt) {
              dateParsed += 1;
              if (!oldestPublishedAt || publishedAt < oldestPublishedAt) oldestPublishedAt = publishedAt;
            }

            if (!title || !publishedAt || !href || !articleId || !isWithinRecentDays(publishedAt, definition.recentDays)) return;

            recentPassed += 1;
            reports.push({
              id: Number(articleId) || index,
              title,
              organization: ORGANIZATION,
              category: definition.category,
              summary: '',
              publishedAt,
              url: absoluteUrl(KOREA_BANK_LIST_URL, href),
            });
          });

          if (oldestPublishedAt && !isWithinRecentDays(oldestPublishedAt, definition.recentDays)) break;
        }

        console.info(
          `[${ORGANIZATION}] ${definition.name} fetchedPages=${fetchedPages} rawRows=${rawRows} titleParsed=${titleParsed} dateParsed=${dateParsed} recentPassed=${recentPassed}`,
        );
      } catch (error) {
        console.error(`[${ORGANIZATION}] ${definition.name} fetch failed:`, error);
      }
    }

    console.info(`[${ORGANIZATION}] finalReports=${reports.length}`);
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
