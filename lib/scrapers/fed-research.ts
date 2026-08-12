import { JSDOM } from 'jsdom';
import { isWithinRecentDays, normalizeText, parseDate, sortReports } from '@/lib/scrapers/additional-public-research';
import { Report } from '@/types/report';

const ORGANIZATION = 'Federal Reserve';
const CATEGORY = '연구보고서';
const RECENT_DAYS = 28;
const FEDS_NOTES_URL = 'https://www.federalreserve.gov/econres/notes/feds-notes/';
const FEDS_NOTES_RSS_URL = 'https://www.federalreserve.gov/feeds/feds_notes.xml';
const IFDP_URL = 'https://www.federalreserve.gov/econres/ifdp/';
const IFDP_RSS_URL = 'https://www.federalreserve.gov/feeds/ifdp.xml';
const MPR_LIST_URL = 'https://www.federalreserve.gov/monetarypolicy/publications/mpr_default.htm';
const FSR_LIST_URL = 'https://www.federalreserve.gov/publications/financial-stability-report.htm';

type RssEntry = { publishedAt: string; url: string };

function createId(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

async function fetchHtmlDocument(url: string): Promise<Document> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return new JSDOM(await response.text()).window.document;
}

async function fetchRssEntries(url: string): Promise<Map<string, RssEntry>> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) throw new Error(`RSS request failed: ${response.status}`);

  const document = new JSDOM(await response.text(), { contentType: 'text/xml' }).window.document;
  const entries = new Map<string, RssEntry>();
  document.querySelectorAll('item').forEach((item) => {
    const rawDate = normalizeText(item.querySelector('pubDate')?.textContent);
    const rawUrl = normalizeText(item.querySelector('link')?.textContent);
    const date = new Date(rawDate);
    if (!rawUrl || Number.isNaN(date.getTime())) return;
    entries.set(rawUrl, { url: rawUrl, publishedAt: date.toISOString().slice(0, 10) });
  });
  return entries;
}

function createReport(title: string, publishedAt: string, url: string, summary: string): Report {
  return {
    id: createId(url),
    title,
    organization: ORGANIZATION,
    category: CATEGORY,
    publishedAt,
    url,
    summary,
  };
}

function extractParagraphs(root: Element | null): string {
  if (!root) return '';
  const paragraphs = Array.from(root.querySelectorAll('p'))
    .map((element) => normalizeText(element.textContent))
    .filter((text) => text && !/^DOI:/i.test(text));
  return paragraphs.join('\n\n');
}

function extractFedsNotesListSummary(card: Element): string {
  const authors = card.querySelector('.authors');
  if (!authors) return '';

  // 목록 카드에서 저자 다음의 첫 설명 블록만 사용한다. 태그명은 고정하지 않고,
  // DOI 또는 "Read More" 영역을 만나면 이후의 메타·링크 콘텐츠는 제외한다.
  const description = authors.nextElementSibling;
  const text = normalizeText(description?.textContent);
  if (text && !/^DOI\s*:/i.test(text) && !description?.classList.contains('link-more')) return text;

  return '';
}

async function fetchFedsNotes(): Promise<Report[]> {
  const [document, rssEntries] = await Promise.all([fetchHtmlDocument(FEDS_NOTES_URL), fetchRssEntries(FEDS_NOTES_RSS_URL)]);
  const reportsByUrl = new Map<string, Report>();

  const candidates = Array.from(document.querySelectorAll('.heading.feds-note')).flatMap((card) => {
    const anchor = card.querySelector<HTMLAnchorElement>('h5 a[href]');
    const href = anchor?.getAttribute('href');
    const title = normalizeText(anchor?.textContent);
    if (!href || !title) return [];
    const url = new URL(href, FEDS_NOTES_URL).toString();
    const rssEntry = rssEntries.get(url);
    const publishedAt = rssEntry?.publishedAt || parseDate(normalizeText(card.querySelector('time')?.textContent));
    if (!publishedAt || !isWithinRecentDays(publishedAt, RECENT_DAYS)) return [];
    return [{ title, publishedAt, url, summary: extractFedsNotesListSummary(card) }];
  });

  candidates.forEach(({ title, publishedAt, url, summary }) => {
    reportsByUrl.set(url, createReport(title, publishedAt, url, summary));
  });

  console.info(`[${ORGANIZATION}] FEDS Notes candidates=${document.querySelectorAll('.heading.feds-note').length} finalReports=${reportsByUrl.size}`);
  return Array.from(reportsByUrl.values());
}

async function fetchIfdp(): Promise<Report[]> {
  const [document, rssEntries] = await Promise.all([fetchHtmlDocument(IFDP_URL), fetchRssEntries(IFDP_RSS_URL)]);
  const reportsByUrl = new Map<string, Report>();

  document.querySelectorAll('.heading.feds-note').forEach((card) => {
    const anchor = card.querySelector<HTMLAnchorElement>('h5 a[href]');
    const href = anchor?.getAttribute('href');
    const title = normalizeText(anchor?.textContent);
    if (!href || !title) return;
    const url = new URL(href, IFDP_URL).toString();
    // IFDP 목록 날짜는 월 단위이므로 Fed 공식 RSS의 pubDate를 우선한다.
    const publishedAt = rssEntries.get(url)?.publishedAt;
    if (!publishedAt || !isWithinRecentDays(publishedAt, RECENT_DAYS)) return;

    const abstract = normalizeText(card.querySelector('.collapse')?.textContent).replace(/^Abstract:\s*/i, '');
    reportsByUrl.set(url, createReport(title, publishedAt, url, abstract));
  });

  console.info(`[${ORGANIZATION}] IFDP candidates=${document.querySelectorAll('.heading.feds-note').length} finalReports=${reportsByUrl.size}`);
  return Array.from(reportsByUrl.values());
}

function parseEnglishDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function findPdfDate(url: string): string {
  const match = url.match(/(20\d{2})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

async function fetchMonetaryPolicyReport(): Promise<Report[]> {
  const document = await fetchHtmlDocument(MPR_LIST_URL);
  const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="-mpr-statement.htm"]')).at(0);
  const href = link?.getAttribute('href');
  if (!href) return [];

  const url = new URL(href, MPR_LIST_URL).toString();
  const detail = await fetchHtmlDocument(url);
  const title = normalizeText(detail.querySelector('.article h2')?.textContent);
  const submittedDate = normalizeText(detail.querySelector('.article h3.subheading')?.textContent)
    .match(/submitted to the Congress on ([A-Za-z]+ \d{1,2}, 20\d{2})/i)?.[1] || '';
  const pdfHref = detail.querySelector<HTMLAnchorElement>('.article a[href*="mprfullreport.pdf"]')?.getAttribute('href') || '';
  const publishedAt = parseEnglishDate(submittedDate) || findPdfDate(pdfHref);
  if (!title || !publishedAt || !isWithinRecentDays(publishedAt, RECENT_DAYS)) return [];

  const summaryHref = Array.from(detail.querySelectorAll<HTMLAnchorElement>('.article a[href]'))
    .find((anchor) => normalizeText(anchor.textContent) === 'Summary')?.getAttribute('href');
  const summaryDocument = summaryHref ? await fetchHtmlDocument(new URL(summaryHref, url).toString()) : detail;
  const summary = extractParagraphs(summaryDocument.querySelector('.article'));
  const report = createReport(title, publishedAt, url, summary);
  console.info(`[${ORGANIZATION}] Monetary Policy Report finalReports=1`);
  return [report];
}

async function fetchFinancialStabilityReport(): Promise<Report[]> {
  const document = await fetchHtmlDocument(FSR_LIST_URL);
  const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="financial-stability-report-purpose-and-framework.htm"]')).at(0);
  const href = link?.getAttribute('href');
  if (!href) return [];

  const url = new URL(href, FSR_LIST_URL).toString();
  const detail = await fetchHtmlDocument(url);
  const title = normalizeText(detail.querySelector('.article h2')?.textContent);
  const pdfHref = detail.querySelector<HTMLAnchorElement>('.article a[href*="financial-stability-report-"][href$=".pdf"]')?.getAttribute('href') || '';
  const publishedAt = findPdfDate(pdfHref);
  if (!title || !publishedAt || !isWithinRecentDays(publishedAt, RECENT_DAYS)) return [];

  const overviewHref = Array.from(detail.querySelectorAll<HTMLAnchorElement>('.article a[href*="financial-stability-report-overview.htm"]'))
    .at(0)?.getAttribute('href');
  const overviewDocument = overviewHref ? await fetchHtmlDocument(new URL(overviewHref, url).toString()) : detail;
  const summary = extractParagraphs(overviewDocument.querySelector('.article'));
  const report = createReport(title, publishedAt, url, summary);
  console.info(`[${ORGANIZATION}] Financial Stability Report finalReports=1`);
  return [report];
}

export async function fetchFederalReserveReports(): Promise<Report[]> {
  try {
    const results = await Promise.allSettled([
      fetchFedsNotes(),
      fetchIfdp(),
      fetchMonetaryPolicyReport(),
      fetchFinancialStabilityReport(),
    ]);
    const sourceNames = ['FEDS Notes', 'IFDP', 'Monetary Policy Report', 'Financial Stability Report'];
    const reportsByUrl = new Map<string, Report>();

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') result.value.forEach((report) => reportsByUrl.set(report.url, report));
      else console.error(`[${ORGANIZATION}] ${sourceNames[index]} fetch failed:`, result.reason);
    });

    const reports = sortReports(Array.from(reportsByUrl.values()));
    console.info(`[${ORGANIZATION}] finalReports=${reports.length}`);
    return reports;
  } catch (error) {
    console.error(`${ORGANIZATION} fetch failed:`, error);
    return [];
  }
}
