import { fetchDocument, isReport, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const MSS_URL = 'https://www.mss.go.kr/site/smba/ex/bbs/List.do?cbIdx=86';
const ORGANIZATION = '중소벤처기업부';

export async function fetchMssReports(): Promise<Report[]> {
  try {
    const document = await fetchDocument(ORGANIZATION, MSS_URL);
    const candidates = Array.from(document.querySelectorAll('tr[onclick*="doBbsFView"]'));
    console.info(`[${ORGANIZATION}] selectorCandidates=${candidates.length}`);

    const reports = candidates
      .map((row, index): Report | null => {
        const cells = Array.from(row.querySelectorAll(':scope > td')).map((cell) => normalizeText(cell.textContent));
        const title = cells[1] || '';
        const publishedAt = parseDate(cells[4] || '');
        const ids = row.getAttribute('onclick')?.match(/doBbsFView\('86','(\d+)','[^']*','(\d+)'\)/);
        const articleId = ids?.[1];
        const parentSeq = ids?.[2];

        if (!title || !publishedAt || !articleId || !parentSeq || !isWithinRecentDays(publishedAt, 14)) return null;
        return {
          id: Number(articleId) || index,
          title,
          organization: ORGANIZATION,
          category: '보도자료',
          summary: '',
          publishedAt,
          url: `https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=${articleId}&parentSeq=${parentSeq}`,
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
