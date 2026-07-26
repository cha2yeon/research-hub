import { Report } from '@/types/report';

const KIF_BASE_URL = 'https://www.kif.re.kr/kif4';
const KIF_LIST_API_URL = `${KIF_BASE_URL}/biz/async_proc`;
const PAGE_SIZE = 10;
const LIST_DEFINITIONS = [
  { mid: '10', listUrl: `${KIF_BASE_URL}/publication/pub_list?mid=10` },
  { mid: '20', listUrl: `${KIF_BASE_URL}/publication/pub_list?mid=20` },
  { mid: '22', listUrl: `${KIF_BASE_URL}/publication/pub_list?mid=22` },
  { mid: '23', listUrl: `${KIF_BASE_URL}/publication/pub_list?mid=23` },
];

interface KifApiRecord {
  mid?: string;
  nid?: string;
  sid?: string;
  vid?: string;
  cno?: string;
  title?: string;
  pubdate?: string;
}

interface KifApiResponse {
  datalist?: unknown;
  totalcnt?: string | number;
}

type KifParsedDate = Pick<Report, 'publishedAt' | 'datePrecision'>;

function isKifApiRecord(value: unknown): value is KifApiRecord {
  return typeof value === 'object' && value !== null;
}

function toIsoDate(year: string, month: string, day: string): string | null {
  const value = new Date(Number(year), Number(month) - 1, Number(day));
  if (value.getFullYear() !== Number(year) || value.getMonth() !== Number(month) - 1 || value.getDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseKifDate(value: string | undefined): KifParsedDate | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() || '';
  if (!normalized) return null;

  const compact = normalized.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (compact) {
    const publishedAt = toIsoDate(compact[1], compact[2], compact[3]);
    return publishedAt ? { publishedAt, datePrecision: 'day' } : null;
  }

  const separated = normalized.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (separated) {
    const publishedAt = toIsoDate(separated[1], separated[2], separated[3]);
    return publishedAt ? { publishedAt, datePrecision: 'day' } : null;
  }

  const korean = normalized.match(/\b(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) {
    const publishedAt = toIsoDate(korean[1], korean[2], korean[3]);
    return publishedAt ? { publishedAt, datePrecision: 'day' } : null;
  }

  const monthOnly = normalized.match(/\b(20\d{2})[-./](\d{1,2})\b|\b(20\d{2})년\s*(\d{1,2})월/);
  if (monthOnly) {
    const year = monthOnly[1] || monthOnly[3];
    const month = monthOnly[2] || monthOnly[4];
    const publishedAt = toIsoDate(year, month, '01');
    return publishedAt ? { publishedAt, datePrecision: 'month' } : null;
  }

  return null;
}

function isWithinLastFourWeeks(date: string): boolean {
  const publishedAt = new Date(`${date}T00:00:00`);
  const start = new Date();
  start.setDate(start.getDate() - 28);
  start.setHours(0, 0, 0, 0);
  return !Number.isNaN(publishedAt.getTime()) && publishedAt >= start && publishedAt <= new Date();
}

function isCurrentOrPreviousMonth(date: string): boolean {
  const current = new Date();
  const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const monthKey = date.slice(0, 7);
  return monthKey === `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}` ||
    monthKey === `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

function shouldInclude(parsedDate: KifParsedDate): boolean {
  return parsedDate.datePrecision === 'month'
    ? isCurrentOrPreviousMonth(parsedDate.publishedAt)
    : isWithinLastFourWeeks(parsedDate.publishedAt);
}

function createDetailUrl(record: KifApiRecord, page: number): string {
  const params = new URLSearchParams({ mid: record.mid || '', nid: record.nid || '', sid: record.sid || '', vid: record.vid || '', cno: record.cno || '', pn: String(page) });
  return `${KIF_BASE_URL}/publication/pub_detail?${params.toString()}`;
}

function compareKifReports(left: Report, right: Report): number {
  const monthComparison = right.publishedAt.slice(0, 7).localeCompare(left.publishedAt.slice(0, 7));
  if (monthComparison !== 0) return monthComparison;
  if (left.datePrecision !== right.datePrecision) return left.datePrecision === 'month' ? 1 : -1;
  return right.publishedAt.localeCompare(left.publishedAt);
}

function logKifListResult(details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'development') console.log('[KIF list]', details);
}

async function fetchKifList({ mid, listUrl }: typeof LIST_DEFINITIONS[number]): Promise<Report[]> {
  const reports: Report[] = [];
  let page = 1;
  let maxPages = 1;

  while (page <= maxPages) {
    const params = new URLSearchParams({ ac: 'dataSearch', mid, nid: '0', vid: '0', t1: '', t2: '', df: '', dt: '', kw: '', pn: String(page), at: '0', sfield: '', pcnt: String(PAGE_SIZE), lang: '0' });
    const apiUrl = `${KIF_LIST_API_URL}?${params.toString()}`;

    try {
      const response = await fetch(apiUrl, {
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01', Referer: listUrl, 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' },
        next: { revalidate: 60 * 60 },
      });
      if (!response.ok) throw new Error(`Failed to fetch KIF list: ${response.status}`);

      const payload = JSON.parse(await response.text()) as KifApiResponse;
      const records = Array.isArray(payload.datalist) ? payload.datalist.filter(isKifApiRecord) : [];
      maxPages = Math.max(1, Math.ceil(Number(payload.totalcnt || 0) / PAGE_SIZE));
      let dateParseFailures = 0;
      let recentCount = 0;
      let hasRelevantDate = false;

      records.forEach((record, index) => {
        const parsedDate = parseKifDate(record.pubdate);
        const title = record.title?.replace(/\s+/g, ' ').trim() || '';
        if (!parsedDate || !title || !record.vid) {
          dateParseFailures += 1;
          return;
        }
        if (!shouldInclude(parsedDate)) return;

        hasRelevantDate = true;
        recentCount += 1;
        reports.push({
          id: Number(record.vid) || index,
          title,
          organization: '한국금융연구원',
          category: '연구보고서',
          ...parsedDate,
          url: createDetailUrl(record, page),
          summary: '',
        });
      });

      logKifListResult({ listUrl, apiUrl, status: response.status, found: records.length, dateParseFailures, recentCount });
      if (records.length === 0 || !hasRelevantDate) break;
      page += 1;
    } catch (error) {
      logKifListResult({ listUrl, apiUrl, error: error instanceof Error ? error.message : String(error) });
      break;
    }
  }

  return reports;
}

export async function fetchKifResearchReports(): Promise<Report[]> {
  const seen = new Set<string>();
  return (await Promise.all(LIST_DEFINITIONS.map(fetchKifList)))
    .flat()
    .filter((report) => {
      if (seen.has(report.url)) return false;
      seen.add(report.url);
      return true;
    })
    .sort(compareKifReports);
}
