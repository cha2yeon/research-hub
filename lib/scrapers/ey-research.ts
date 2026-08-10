import { fetchDocument, isWithinRecentDays, normalizeText, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = 'EY한영';
const CATEGORY = '연구보고서';
const RECENT_DAYS = 28;
const LIST_URLS = [
  'https://www.ey.com/ko_kr/insights',
  'https://www.ey.com/ko_kr/market-insights',
];

function createId(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function readPublishedAt(card: Element): string {
  const template = card.querySelector<HTMLTemplateElement>('template');
  const value = template?.content.querySelector<HTMLElement>('[data-up-date-user]')?.dataset.upDateUser;
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function fetchEyList(listUrl: string): Promise<Report[]> {
  const document = await fetchDocument(ORGANIZATION, listUrl);
  const reportsByUrl = new Map<string, Report>();
  const cards = Array.from(document.querySelectorAll('.up-content-grid__list-item'));

  for (const card of cards) {
    const anchor = card.querySelector<HTMLAnchorElement>('.up-content-grid__list-item-title-link');
    const title = normalizeText(anchor?.textContent);
    const href = anchor?.getAttribute('href');
    const publishedAt = readPublishedAt(card);
    if (!title || !href || !publishedAt || !isWithinRecentDays(publishedAt, RECENT_DAYS)) continue;

    const url = new URL(href, listUrl).toString();
    reportsByUrl.set(url, {
      id: createId(url),
      title,
      organization: ORGANIZATION,
      category: CATEGORY,
      publishedAt,
      url,
    });
  }

  console.info(`[${ORGANIZATION}] list=${listUrl} candidates=${cards.length} recentReports=${reportsByUrl.size}`);
  return Array.from(reportsByUrl.values());
}

export async function fetchEyResearchReports(): Promise<Report[]> {
  try {
    const results = await Promise.allSettled(LIST_URLS.map(fetchEyList));
    const reportsByUrl = new Map<string, Report>();

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((report) => reportsByUrl.set(report.url, report));
      } else {
        console.error(`[${ORGANIZATION}] list fetch failed: ${LIST_URLS[index]}`, result.reason);
      }
    });

    const reports = sortReports(Array.from(reportsByUrl.values()));
    console.info(`[${ORGANIZATION}] finalReports=${reports.length}`);
    return reports;
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
