import { fetchDocument, isReport, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const MOTIE_URL = 'https://www.motie.go.kr/kor/article/ATCL3f49a5a8c';
const ORGANIZATION = '산업통상자원부';

export async function fetchMotieReports(): Promise<Report[]> {
  try {
    const document = await fetchDocument(ORGANIZATION, MOTIE_URL);
    const candidates = Array.from(document.querySelectorAll('tr'));
    console.info(`[${ORGANIZATION}] selectorCandidates=${candidates.length - 1}`);

    const reports = candidates
      .map((row, index): Report | null => {
        const cells = Array.from(row.querySelectorAll(':scope > td')).map((cell) => normalizeText(cell.textContent));
        const anchor = row.querySelector('.board-link a');
        const title = normalizeText(anchor?.textContent);
        const publishedAt = parseDate(cells[4] || '');
        const rawCategory = cells[1] || '보도자료';
        const category = rawCategory === '참고자료' ? '보도자료' : rawCategory;
        const articleId = anchor?.getAttribute('href')?.match(/article\.view\('(\d+)'\)/)?.[1];

        if (!title || !publishedAt || !articleId || !isWithinRecentDays(publishedAt, 14)) return null;
        return {
          id: Number(articleId) || index,
          title,
          organization: ORGANIZATION,
          category,
          summary: '',
          publishedAt,
          url: `https://www.motie.go.kr/kor/article/ATCL3f49a5a8c/${articleId}/view`,
        } satisfies Report;
      })
      .filter(isReport);
    console.info(`[${ORGANIZATION}] beforeDateFilter=${reports.length} afterDateFilter=${reports.length} finalReports=${reports.length}`);
    return sortReports(reports);
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
