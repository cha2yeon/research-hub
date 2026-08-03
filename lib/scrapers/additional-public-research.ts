import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';

const USER_AGENT = 'Mozilla/5.0';

export function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

export function parseDate(value: string): string {
  const match = value.match(/(20\d{2})[.-](\d{1,2})[.-](\d{1,2})/);
  if (!match) return '';

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function isWithinRecentDays(publishedAt: string, days: number): boolean {
  const date = new Date(`${publishedAt}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return date >= start && date <= new Date();
}

export function sortReports(reports: Report[]): Report[] {
  return [...reports].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function isReport(report: Report | null): report is Report {
  return report !== null;
}

export function absoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export async function fetchDocument(organization: string, url: string): Promise<Document> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    next: { revalidate: 60 * 60 },
  });
  const contentType = response.headers.get('content-type') || 'unknown';
  console.info(`[${organization}] request url=${response.url} status=${response.status} content-type=${contentType}`);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);

  const body = await response.text();
  if (!contentType.includes('html')) {
    throw new Error(`Unexpected response type: ${contentType}`);
  }
  return new JSDOM(body).window.document;
}
