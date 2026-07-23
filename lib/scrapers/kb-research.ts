import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';
import { createRuleBasedSummary } from '@/lib/utils/rule-based-summary';

const KB_RESEARCH_URL = 'https://www.kbfg.com/kbresearch/report/reportList.do';
const KB_ORGANIZATION = 'KB경영연구소';
const KB_CATEGORY = '연구보고서';

function normalizeUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://www.kbfg.com${url.startsWith('/') ? '' : '/'}${url}`;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const dateMatch = trimmed.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/);
  return dateMatch?.[0] || trimmed;
}

function isWithinLastMonth(publishedAt: string): boolean {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 28);
  startDate.setHours(0, 0, 0, 0);

  return date >= startDate && date <= now;
}

async function fetchSummary(url: string, title: string): Promise<string> {
  try {
    const html = await fetchHtml(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 60 * 60 } });
    const document = new JSDOM(html).window.document;
    const content = ['main .view-content', 'main .report-content', '#contents .contents', '#contents .view', 'main article']
      .map((selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '')
      .find((text) => text.length > 80) || '';
    return createRuleBasedSummary(content, title);
  } catch {
    return createRuleBasedSummary('', title);
  }
}

export async function fetchKbResearchReports(): Promise<Report[]> {
  try {
    const html = await fetchHtml(KB_RESEARCH_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      next: { revalidate: 60 * 60 },
    });
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const scope = document.querySelector('main') || document.body;
    const items = Array.from(scope.querySelectorAll('li'));

    const reports = items
      .map((item) => {
        const link = Array.from(item.querySelectorAll('a[href]')).find((anchor) => {
          const href = anchor.getAttribute('href') || '';
          return href.includes('reportView.do') || href.includes('reportId=');
        });
        const titleElement = item.querySelector('h3, h4, p, strong');
        const dateElement = Array.from(item.querySelectorAll('dd, span, p')).find((element) => {
          const text = element.textContent?.trim() || '';
          return /\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(text);
        });

        const title = titleElement?.textContent?.trim() || '';
        const publishedAt = parseDate(dateElement?.textContent || '');
        const url = link?.getAttribute('href') || '';

        if (!title || !publishedAt || !url) {
          return null;
        }

        return {
          id: Number.parseInt(url.split('reportId=').pop() || '0', 10),
          title,
          summary: '',
          organization: KB_ORGANIZATION,
          category: KB_CATEGORY,
          publishedAt,
          url: normalizeUrl(url),
        } satisfies Report;
      })
      .filter((report): report is NonNullable<typeof report> => report !== null);

    if (reports.length === 0) {
      throw new Error('No reports parsed from KB research page');
    }

    const recentReports = reports.filter((report) => isWithinLastMonth(report.publishedAt)).sort((left, right) => {
      const leftDate = new Date(left.publishedAt);
      const rightDate = new Date(right.publishedAt);
      return Number.isNaN(rightDate.getTime()) ? 0 : rightDate.getTime() - leftDate.getTime();
    });

    return recentReports;
  } catch (error) {
    console.error('KB research fetch failed:', error);
    return [];
  }
}
