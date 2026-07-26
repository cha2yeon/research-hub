import { Report } from '@/types/report';
import { fetchHtml } from '@/lib/scrapers/http';

const LIST_URL = 'https://rd.kdb.co.kr/BOUBUF01R01.jct';
const ORGANIZATION = 'KDB미래전략연구소';

const BOARDS = [
  {
    category: '이슈분석',
    itrBlbId: 'STD423',
    linkType: 'detail',
    listUrl: 'https://rd.kdb.co.kr/FLSRIA02N01.act?_mnuld=FYERER0017',
    detailUrl: 'https://rd.kdb.co.kr/BOUBUF02N00.act?FIRST_MENU_ID=FLSRIA02N01&menuId=FYERER0017',
  },
  {
    category: '경제동향',
    itrBlbId: 'STD425',
    linkType: 'list',
    listUrl: 'https://rd.kdb.co.kr/FLTAET01N01.act?_mnuld=FYERER0019',
  },
  {
    category: '산업동향',
    itrBlbId: 'STD427',
    linkType: 'list',
    listUrl: 'https://rd.kdb.co.kr/FLTAIT03N01.act?_mnuld=FYERER0021',
  },
] as const;

interface KdbRecord {
  NAC_CONE_TTL?: string;
  FST_ENR_DTM?: string;
  LST_CHG_DTM?: string;
  ITR_NAC_ID_MNG_SNO?: string;
  ITR_BLB_ID?: string;
  ADD_FL_MPN_ID?: string;
  FILE_ID?: string;
  NAC_SMRY_CONE?: string;
}

interface KdbListResponse {
  STDLIST_REC?: unknown;
}

interface KdbBoardReport {
  report: Report;
  dedupeKey: string;
}

function normalizeDate(value: string | undefined): string {
  const digits = value?.replace(/\D/g, '') || '';
  return /^\d{8}/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : '';
}

function isWithinLastFourWeeks(date: string): boolean {
  const publishedAt = new Date(date);
  const start = new Date();
  start.setDate(start.getDate() - 28);
  start.setHours(0, 0, 0, 0);
  return !Number.isNaN(publishedAt.getTime()) && publishedAt >= start && publishedAt <= new Date();
}

function isKdbRecord(value: unknown): value is KdbRecord {
  return typeof value === 'object' && value !== null;
}

function createSourceUrl(
  board: (typeof BOARDS)[number],
  record: KdbRecord,
): string {
  if (board.linkType === 'list') return board.listUrl;

  const url = new URL(board.detailUrl);
  if (record.ITR_NAC_ID_MNG_SNO) {
    url.searchParams.set('ITR_NAC_ID_MNG_SNO', record.ITR_NAC_ID_MNG_SNO);
  }
  url.searchParams.set('ITR_BLB_ID', record.ITR_BLB_ID || board.itrBlbId);
  if (record.ADD_FL_MPN_ID) url.searchParams.set('ADD_FL_MPN_ID', record.ADD_FL_MPN_ID);
  if (record.FILE_ID) url.searchParams.set('FILE_ID', record.FILE_ID);
  return url.toString();
}

function createPayload(itrBlbId: string) {
  return {
    SEARCH_CONDITION: '',
    SEARCH_KEYWORD: '',
    SEARCH_CATEGORY: '',
    ORDER_TYPE: 'new',
    MODE: '',
    ITR_BLB_ID: itrBlbId,
    HEADER_STD_WEB: {
      REQ_PAGE_NO: 1,
      PAGE_ROW_COUNT: '10',
      NEXT_PAGE_YN: 'S',
      NEXTPAGDTT: 'P',
      GRID_NEXTKEY_ITR_CND: '',
    },
  };
}

async function createSessionCookies(referer: string): Promise<string[]> {
  const response = await fetch(referer, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to initialize KDB session: ${response.status}`);
  }

  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = (headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean);
  if (!cookies.some((value) => value.startsWith('JEX_LANG='))) cookies.push('JEX_LANG=KO');
  return cookies;
}

async function fetchKdbBoard(
  board: (typeof BOARDS)[number],
  cookies: string[],
): Promise<KdbBoardReport[]> {
  const encodedPayload = encodeURIComponent(JSON.stringify(createPayload(board.itrBlbId)));
  const body = new URLSearchParams({ _JSON_: encodedPayload });
  const response = JSON.parse(await fetchHtml(LIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      Cookie: cookies.join('; '),
      Referer: board.listUrl,
      Accept: '*/*',
      'Accept-Language': 'ko,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })) as KdbListResponse;

  if (!Array.isArray(response.STDLIST_REC)) {
    if ('LOGIN_VIEWID' in response) {
      throw new Error('KDB session validation failed: LOGIN_VIEWID response received');
    }
    return [];
  }

  return response.STDLIST_REC
    .filter(isKdbRecord)
    .map((record, index): KdbBoardReport | null => {
      const title = record.NAC_CONE_TTL?.replace(/\s+/g, ' ').trim() || '';
      const publishedAt = normalizeDate(record.FST_ENR_DTM || record.LST_CHG_DTM);
      if (!title || !publishedAt || !isWithinLastFourWeeks(publishedAt)) return null;

      return {
        dedupeKey: record.FILE_ID || `${title}-${publishedAt}`,
        report: {
          id: Number(record.ITR_NAC_ID_MNG_SNO) || index,
          title,
          organization: ORGANIZATION,
          category: board.category,
          publishedAt,
          url: createSourceUrl(board, record),
          summary: record.NAC_SMRY_CONE?.replace(/\s+/g, ' ').trim() || '',
        },
      };
    })
    .filter((result): result is KdbBoardReport => result !== null);
}

export async function fetchKdbResearchReports(): Promise<Report[]> {
  try {
    const cookies = await createSessionCookies(BOARDS[0].listUrl);
    const boardReports = await Promise.all(BOARDS.map((board) => fetchKdbBoard(board, cookies)));
    const seen = new Set<string>();

    return boardReports
      .flat()
      .filter(({ dedupeKey }) => {
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      })
      .map(({ report }) => report)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } catch (error) {
    console.error('KDB 미래전략연구소 fetch failed:', error);
    return [];
  }
}
