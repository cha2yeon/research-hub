import { JSDOM } from 'jsdom';
import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';

const LIST_URL = 'https://www.wfri.re.kr/ko/web/research_report/research_report.php';

function recent(date: string) {
  const value = new Date(date);
  const start = new Date();
  start.setDate(start.getDate() - 28);
  start.setHours(0, 0, 0, 0);
  return !Number.isNaN(value.getTime()) && value >= start && value <= new Date();
}

export async function fetchWfriResearchReports(): Promise<Report[]> {
  try {
    const document = new JSDOM(await fetchHtml(LIST_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } })).window.document;
    return Array.from(document.querySelectorAll('a.report-item[href]')).map((item, index): Report | null => {
      const title = item.querySelector('.report-item__title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const date = (item.textContent || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      const href = item.getAttribute('href') || '';
      if (!title || !date || !href || !recent(date)) return null;
      return { id: Number(new URL(href, LIST_URL).searchParams.get('idx') || index), title, organization: '우리금융경영연구소', category: '연구보고서', publishedAt: date, url: new URL(href, LIST_URL).toString(), summary: '' } satisfies Report;
    }).filter((report): report is Report => report !== null).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } catch (error) {
    console.error('WFRI research fetch failed:', error);
    return [];
  }
}
