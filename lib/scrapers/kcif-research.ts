import { fetchDocument, isReport, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = '국제금융센터(KCIF)';
const LIST_URL = 'https://www.kcif.or.kr/report/reportList';
const RECENT_DAYS = 28;
const PAGE_SIZE = 10;

const INCLUDED_CATEGORIES = new Set([
  '국제금융 > 은행',
  '정기보고서 > 주간',
  '정기보고서 > 월간',
]);

const WORLD_ECONOMY_PREFIX = '세계경제 >';
const INTERNATIONAL_FINANCE_FLASH_MENU = '001002';
const FUND_FLOW_SERIES = '003003';

function createListUrl(page: number): string {
  const url = new URL(LIST_URL);
  url.searchParams.set('year', String(new Date().getFullYear()));
  url.searchParams.set('pp', String(PAGE_SIZE));
  url.searchParams.set('pg', String(page));
  return url.toString();
}

function getPublishedAt(row: Element): string {
  const dateText = Array.from(row.querySelectorAll('.txt_wrap span'))
    .map((span) => normalizeText(span.textContent))
    .find((text) => /^20\d{2}\.\d{2}\.\d{2}$/.test(text));
  return dateText ? parseDate(dateText) : '';
}

function isIncludedCategory(category: string, detailUrl: URL): boolean {
  if (detailUrl.searchParams.get('mn') === INTERNATIONAL_FINANCE_FLASH_MENU) return false;
  if (category.startsWith(WORLD_ECONOMY_PREFIX)) return true;
  if (!INCLUDED_CATEGORIES.has(category)) return false;
  return !(category === '정기보고서 > 주간' && detailUrl.searchParams.get('pe') === FUND_FLOW_SERIES);
}

export async function fetchKcifResearchReports(): Promise<Report[]> {
  const reportsById = new Map<string, Report>();
  let fetchedPages = 0;

  try {
    for (let page = 1; ; page += 1) {
      const document = await fetchDocument(ORGANIZATION, createListUrl(page));
      const rows = Array.from(document.querySelectorAll('li')).filter((row) => Boolean(row.querySelector('a[href*="View"]')));
      fetchedPages += 1;
      if (rows.length === 0) break;

      const pageDates: string[] = [];
      rows.forEach((row, index) => {
        const anchor = row.querySelector<HTMLAnchorElement>('a[href*="View"]');
        const category = normalizeText(row.querySelector('.tit_bar')?.textContent);
        const title = normalizeText(anchor?.textContent);
        const publishedAt = getPublishedAt(row);
        const href = anchor?.getAttribute('href');
        if (!anchor || !title || !category || !publishedAt || !href) return;

        const url = new URL(href, LIST_URL);
        const reportId = url.searchParams.get('rpt_no');
        if (!reportId) return;

        pageDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS) || !isIncludedCategory(category, url)) return;

        reportsById.set(reportId, {
          id: Number(reportId) || index,
          title,
          organization: ORGANIZATION,
          category: '연구보고서',
          publishedAt,
          url: url.toString(),
        });
      });

      if (pageDates.length > 0 && pageDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
    }

    const reports = Array.from(reportsById.values()).filter(isReport);
    const categoryCounts = reports.reduce<Record<string, number>>((counts, report) => {
      const sourceCategory = new URL(report.url).pathname.includes('/annual/') ? '정기보고서' : new URL(report.url).pathname.includes('/economy/') ? '세계경제' : '국제금융';
      counts[sourceCategory] = (counts[sourceCategory] || 0) + 1;
      return counts;
    }, {});
    console.info(`[${ORGANIZATION}] fetchedPages=${fetchedPages} finalReports=${reports.length} categories=${JSON.stringify(categoryCounts)}`);
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
