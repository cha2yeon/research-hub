import { fetchDocument, isReport, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = '기획예산처';
const LIST_URL = 'https://www.mpb.go.kr/web/main/bbs/b_0001/list';
const RECENT_DAYS = 14;

function createListUrl(page: number): string {
  const url = new URL(LIST_URL);
  url.searchParams.set('cp', String(page));
  return url.toString();
}

export async function fetchMpbPressReleases(): Promise<Report[]> {
  const reportsByUrl = new Map<string, Report>();
  let fetchedPages = 0;

  try {
    for (let page = 1; ; page += 1) {
      const document = await fetchDocument(ORGANIZATION, createListUrl(page));
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/web/main/bbs/b_0001/"]'))
        .filter((anchor) => /\/b_0001\/\d+(?:\?|$)/.test(anchor.href));
      fetchedPages += 1;
      if (anchors.length === 0) break;

      const pageDates: string[] = [];
      anchors.forEach((anchor, index) => {
        const title = normalizeText(anchor.textContent);
        const row = anchor.closest('li, tr, article, .board-list-box > div') || anchor.parentElement;
        const publishedAt = parseDate(normalizeText(row?.textContent));
        const url = new URL(anchor.getAttribute('href') || '', LIST_URL).toString();
        const articleId = url.match(/\/b_0001\/(\d+)/)?.[1] || '';
        if (!title || !publishedAt || !articleId) return;

        pageDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS)) return;
        reportsByUrl.set(url, {
          id: Number(articleId) || index,
          title,
          organization: ORGANIZATION,
          category: '보도자료',
          publishedAt,
          url,
        });
      });

      if (pageDates.length > 0 && pageDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
    }

    const reports = Array.from(reportsByUrl.values()).filter(isReport);
    console.info(`[${ORGANIZATION}] fetchedPages=${fetchedPages} finalReports=${reports.length}`);
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
