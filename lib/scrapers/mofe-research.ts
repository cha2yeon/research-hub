import { absoluteUrl, fetchDocument, isReport, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = '재정경제부';
const LIST_URL = 'https://www.mofe.go.kr/nw/nes/nesdta.do?bbsId=MOSFBBS_000000000028&menuNo=4010100';
const DETAIL_URL = 'https://www.mofe.go.kr/nw/nes/detailNesDtaView.do';
const BBS_ID = 'MOSFBBS_000000000028';
const RECENT_DAYS = 14;

function createListUrl(pageIndex: number): string {
  const url = new URL(LIST_URL);
  url.searchParams.set('pageIndex', String(pageIndex));
  return url.toString();
}

function createDetailUrl(articleId: string): string {
  const url = new URL(DETAIL_URL);
  url.searchParams.set('searchBbsId1', BBS_ID);
  url.searchParams.set('searchNttId1', articleId);
  url.searchParams.set('menuNo', '4010100');
  return url.toString();
}

export async function fetchMofePressReleases(): Promise<Report[]> {
  const reportsByUrl = new Map<string, Report>();
  let fetchedPages = 0;
  let candidates = 0;
  let titleParsed = 0;
  let dateParsed = 0;
  let recentPassed = 0;

  try {
    for (let pageIndex = 1; ; pageIndex += 1) {
      const document = await fetchDocument(ORGANIZATION, createListUrl(pageIndex));
      const rows = Array.from(document.querySelectorAll('ul.boardType3.explnList > li'));
      fetchedPages += 1;
      candidates += rows.length;
      if (rows.length === 0) break;

      const pageDates: string[] = [];
      rows.forEach((row, index): void => {
        const anchor = row.querySelector<HTMLAnchorElement>('h3 a');
        const title = normalizeText(anchor?.textContent);
        const publishedAt = parseDate(normalizeText(row.querySelector('.boardInfo .date')?.textContent));
        const articleId = anchor?.getAttribute('href')?.match(/fn_egov_select\('([^']+)'\)/)?.[1] || '';

        if (title) titleParsed += 1;
        if (!title || !publishedAt || !articleId) return;

        dateParsed += 1;
        pageDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS)) return;

        recentPassed += 1;
        const url = createDetailUrl(articleId);
        reportsByUrl.set(url, {
          id: Number(articleId.match(/(\d+)$/)?.[1]) || index,
          title,
          organization: ORGANIZATION,
          category: '보도자료',
          publishedAt,
          url: absoluteUrl(LIST_URL, url),
        } satisfies Report);
      });

      // 한 페이지의 유효 날짜를 모두 처리한 후에만 종료한다.
      if (pageDates.length > 0 && pageDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
    }

    const reports = Array.from(reportsByUrl.values()).filter(isReport);
    console.info(`[${ORGANIZATION}] fetchedPages=${fetchedPages} candidates=${candidates} titleParsed=${titleParsed} dateParsed=${dateParsed} recentPassed=${recentPassed} finalReports=${reports.length}`);
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
