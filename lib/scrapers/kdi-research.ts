import { absoluteUrl, fetchDocument, isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = 'KDI(한국개발연구원)';
const RECENT_DAYS = 28;
const MAX_PAGE_COUNT = 12;
const MONTHLY_TRENDS_URL = 'https://www.kdi.re.kr/research/monTrends';

type KdiListConfig = {
  listUrl: string;
  reportSelector: string;
  dateSelector: string;
};

type KdiListResult = {
  pages: number;
  cards: number;
  reports: Report[];
  summaryParsed: number;
  dateParsed: number;
  recentPassed: number;
};

type KdiMonthlyResult = {
  pages: number;
  candidates: number;
  reports: Report[];
  summaryParsed: number;
  dateParsed: number;
  recentPassed: number;
};

const FOCUS_LIST: KdiListConfig = {
  listUrl: 'https://www.kdi.re.kr/research/focusList',
  reportSelector: 'a[href*="focusView?pub_no="]',
  dateSelector: 'strong.title > span',
};

const REPORT_LIST: KdiListConfig = {
  listUrl: 'https://www.kdi.re.kr/research/reportList',
  reportSelector: 'a[href*="reportView?pub_no="]',
  dateSelector: '.tit_top > p > span',
};

function createPageUrl(listUrl: string, pageIndex: number): string {
  const url = new URL(listUrl);
  url.searchParams.set('pg', String(pageIndex));
  return url.toString();
}

function cleanOfficialSummary(root: Element): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    return Array.from(element.childNodes).map(readNode).join('');
  };

  return Array.from(root.childNodes)
    .map(readNode)
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getMonthlyTrendYears(): number[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  return now.getMonth() === 0 ? [currentYear, currentYear - 1] : [currentYear];
}

async function collectMonthlyTrends(): Promise<KdiMonthlyResult> {
  const monthlyUrls = new Set<string>();
  const reportsByUrl = new Map<string, Report>();
  let pages = 0;
  let summaryParsed = 0;
  let dateParsed = 0;
  let recentPassed = 0;

  for (const year of getMonthlyTrendYears()) {
    const document = await fetchDocument(ORGANIZATION, `${MONTHLY_TRENDS_URL}?year=${year}`);
    pages += 1;

    Array.from(document.querySelectorAll<HTMLButtonElement>('.month_view-select .select-month li.open button, .month_view-select .select-month li.on button'))
      .forEach((button) => {
        const pubNo = button.getAttribute('onclick')?.match(/monTrends\?pub_no=(\d+)/)?.[1];
        if (pubNo) monthlyUrls.add(`${MONTHLY_TRENDS_URL}?pub_no=${pubNo}`);
      });
  }

  for (const url of Array.from(monthlyUrls)) {
    try {
      const detailDocument = await fetchDocument(ORGANIZATION, url);
      const title = normalizeText(detailDocument.querySelector('.month_view-conts .m_v-post .post-top .tit .date')?.textContent);
      const publishedAt = parseDate(normalizeText(detailDocument.querySelector('.month_view-conts .m_v-post .post-top .tit-info > .date')?.textContent));
      const summaryDocument = Array.from(detailDocument.querySelectorAll('.post-box .bundlebox.desc dl'))
        .find((element) => normalizeText(element.querySelector('dt')?.textContent).startsWith('국문요약'));
      const summary = summaryDocument ? cleanOfficialSummary(summaryDocument.querySelector('.editor-template') || summaryDocument) : '';

      if (summary) summaryParsed += 1;
      if (!publishedAt) continue;

      dateParsed += 1;
      if (!title || !isWithinRecentDays(publishedAt, RECENT_DAYS)) continue;

      recentPassed += 1;
      reportsByUrl.set(url, {
        id: Number(new URL(url).searchParams.get('pub_no')) || reportsByUrl.size,
        title,
        organization: ORGANIZATION,
        category: '연구보고서',
        summary,
        publishedAt,
        url,
      });
    } catch (error) {
      console.error(`[${ORGANIZATION}] monthly trend detail fetch failed: ${url}`, error);
    }
  }

  return {
    pages,
    candidates: monthlyUrls.size,
    reports: Array.from(reportsByUrl.values()),
    summaryParsed,
    dateParsed,
    recentPassed,
  };
}

async function collectKdiList(config: KdiListConfig): Promise<KdiListResult> {
  const reportsByUrl = new Map<string, Report>();
  let pages = 0;
  let cards = 0;
  let summaryParsed = 0;
  let dateParsed = 0;
  let recentPassed = 0;

  for (let pageIndex = 1; pageIndex <= MAX_PAGE_COUNT; pageIndex += 1) {
    const document = await fetchDocument(ORGANIZATION, createPageUrl(config.listUrl, pageIndex));
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(`.page_list-group ${config.reportSelector}`));
    pages += 1;
    cards += anchors.length;

    if (anchors.length === 0) break;

    const pageDates: string[] = [];
    let pageRecentCount = 0;

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const title = normalizeText(anchor.querySelector('strong')?.textContent);
      const href = anchor.getAttribute('href') || '';
      const articleId = href.match(/[?&]pub_no=(\d+)/)?.[1];
      if (!title || !href || !articleId) continue;

      const url = absoluteUrl(config.listUrl, href);
      const summaryRoot = document.querySelector(`.popup_left-slide.move_summary_view${articleId} .pop_conts .editor-template`);
      const summary = summaryRoot ? cleanOfficialSummary(summaryRoot) : '';
      if (summary) summaryParsed += 1;

      try {
        const detailDocument = await fetchDocument(ORGANIZATION, url);
        const publishedAt = parseDate(normalizeText(detailDocument.querySelector(config.dateSelector)?.textContent));
        if (!publishedAt) continue;

        dateParsed += 1;
        pageDates.push(publishedAt);
        if (!isWithinRecentDays(publishedAt, RECENT_DAYS)) continue;

        pageRecentCount += 1;
        recentPassed += 1;
        reportsByUrl.set(url, {
          id: Number(articleId) || index,
          title,
          organization: ORGANIZATION,
          category: '연구보고서',
          summary,
          publishedAt,
          url,
        });
      } catch (error) {
        console.error(`[${ORGANIZATION}] detail fetch failed: ${url}`, error);
      }
    }

    // reportList is not strictly ordered by the detail-page publication date.
    // Only stop once every valid date on the processed page is older than the cutoff.
    if (pageDates.length > 0 && pageRecentCount === 0 && pageDates.every((date) => !isWithinRecentDays(date, RECENT_DAYS))) break;
  }

  return {
    pages,
    cards,
    reports: Array.from(reportsByUrl.values()),
    summaryParsed,
    dateParsed,
    recentPassed,
  };
}

export async function fetchKdiReports(): Promise<Report[]> {
  try {
    const [focus, reports, monthly] = await Promise.all([collectKdiList(FOCUS_LIST), collectKdiList(REPORT_LIST), collectMonthlyTrends()]);
    const mergedByUrl = new Map<string, Report>();
    [...focus.reports, ...reports.reports, ...monthly.reports].forEach((report) => mergedByUrl.set(report.url, report));
    const mergedReports = Array.from(mergedByUrl.values());
    console.info(
      `[${ORGANIZATION}] focusPages=${focus.pages} focusCards=${focus.cards} focusSummaryParsed=${focus.summaryParsed} focusDateParsed=${focus.dateParsed} focusRecentPassed=${focus.recentPassed} reportPages=${reports.pages} reportCards=${reports.cards} reportSummaryParsed=${reports.summaryParsed} reportDateParsed=${reports.dateParsed} reportRecentPassed=${reports.recentPassed} monthlyPages=${monthly.pages} monthlyCandidates=${monthly.candidates} monthlySummaryParsed=${monthly.summaryParsed} monthlyDateParsed=${monthly.dateParsed} monthlyRecentPassed=${monthly.recentPassed} mergedReports=${mergedReports.length} finalReports=${mergedReports.length}`,
    );
    return sortReports(mergedReports);
  } catch (error) {
    console.error('KDI fetch failed:', error);
    return [];
  }
}
