import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';
import { createRuleBasedSummary } from '@/lib/utils/rule-based-summary';

const HANA_RESEARCH_URL = 'https://www.hanaif.re.kr/boardList.do?menuId=MN1000&tabMenuId=N';
const HANA_ORGANIZATION = '하나금융연구소';
const HANA_CATEGORY = '연구보고서';

type HanaReport = Omit<Report, 'summary'> & { summary: string; listSummary: string };

function normalizeUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('javascript:')) {
    const detailPath = url.match(/goPage\('([^']+)/)?.[1];
    return detailPath ? `https://www.hanaif.re.kr${detailPath}` : '';
  }
  return `https://www.hanaif.re.kr${url.startsWith('/') ? '' : '/'}${url}`;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const dateMatch = trimmed.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/);
  return dateMatch?.[0] || trimmed.replace(/\s+/g, '').replace(/<[^>]+>/g, '');
}

function cleanSummary(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchSummary(url: string, title: string, listSummary: string): Promise<string> {
  try {
    const html = await fetchHtml(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 60 * 60 } });
    const document = new JSDOM(html).window.document;
    const summary = ['#dlvyCtt', '#docfAtclCtt']
      .map((selector) => cleanSummary(document.querySelector(selector)?.innerHTML || ''))
      .find(Boolean);
    return summary || listSummary || createRuleBasedSummary('', title);
  } catch {
    return listSummary || createRuleBasedSummary('', title);
  }
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

export async function fetchHanaResearchReports(): Promise<Report[]> {
  try {
    const html = await fetchHtml(HANA_RESEARCH_URL, {
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
        const detailLink = Array.from(item.querySelectorAll('a[href]')).find((anchor) => {
          const href = anchor.getAttribute('href') || '';
          return href.includes('boardDetail.do') || href.includes('hmpeSeqNo=');
        });
        const title = item.querySelector('p.tit')?.textContent?.trim() || '';
        const listSummary = cleanSummary(item.querySelector('a.txtBox > div.txt')?.innerHTML || '');
        const textContent = item.textContent || '';
        const publishedAt = parseDate(textContent.match(/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/)?.[0] || '');
        const href = detailLink?.getAttribute('href') || '';

        if (!title || !publishedAt || !href) {
          return null;
        }

        const detailMatch = href.match(/hmpeSeqNo=(\d+)/);
        const id = detailMatch ? Number.parseInt(detailMatch[1], 10) : 0;

        return {
          id,
          title,
          summary: '',
          organization: HANA_ORGANIZATION,
          category: HANA_CATEGORY,
          publishedAt,
          url: normalizeUrl(href),
          listSummary,
        } satisfies HanaReport;
      })
      .filter((report): report is HanaReport => report !== null);

    if (reports.length === 0) {
      throw new Error('No reports parsed from Hana research page');
    }

    const recentReports = reports.filter((report) => isWithinLastMonth(report.publishedAt)).sort((left, right) => {
      const leftDate = new Date(left.publishedAt);
      const rightDate = new Date(right.publishedAt);
      return Number.isNaN(rightDate.getTime()) ? 0 : rightDate.getTime() - leftDate.getTime();
    });

    return Promise.all(recentReports.map(async ({ listSummary, ...report }) => ({
      ...report,
      summary: await fetchSummary(report.url, report.title, listSummary),
    })));
  } catch (error) {
    console.error('Hana research fetch failed:', error);
    return [];
  }
}
