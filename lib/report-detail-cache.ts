import { createHash } from 'crypto';

export const REPORT_DETAIL_EXTRACTOR_VERSION = 1;
export const REPORT_DETAIL_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface DetailCacheEntry {
  content: string;
  updatedAt: string;
}

interface RuntimeDetailCache {
  inFlight?: Map<string, Promise<string>>;
}

const runtime = globalThis as typeof globalThis & { __researchHubDetailCache?: RuntimeDetailCache };
const cache = runtime.__researchHubDetailCache ?? (runtime.__researchHubDetailCache = { inFlight: new Map() });

function getSupabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceRoleKey };
}

export function normalizeDetailSourceUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  Array.from(url.searchParams.keys()).forEach((key) => {
    if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
  });
  return url.toString();
}

function createCacheKey(organization: string, sourceUrl: string): string {
  return createHash('sha256').update(`${organization}\n${sourceUrl}`).digest('hex');
}

async function readDetailCache(organization: string, sourceUrl: string): Promise<DetailCacheEntry | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const cacheKey = createCacheKey(organization, sourceUrl);
  try {
    const response = await fetch(`${config.url}/rest/v1/report_detail_cache?cache_key=eq.${cacheKey}&extractor_version=eq.${REPORT_DETAIL_EXTRACTOR_VERSION}&status=eq.success&select=content,updated_at&limit=1`, {
      headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`read failed: ${response.status}`);

    const rows = await response.json() as Array<{ content?: unknown; updated_at?: unknown }>;
    const row = rows[0];
    if (!row || typeof row.content !== 'string' || typeof row.updated_at !== 'string') return null;
    const updatedAt = new Date(row.updated_at);
    if (Number.isNaN(updatedAt.getTime()) || Date.now() - updatedAt.getTime() > REPORT_DETAIL_CACHE_TTL_MS) return null;
    return { content: row.content, updatedAt: row.updated_at };
  } catch (error) {
    console.warn('[report-detail-cache] read failed; using external extraction:', error);
    return null;
  }
}

async function writeDetailCache(organization: string, sourceUrl: string, content: string): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;

  const response = await fetch(`${config.url}/rest/v1/report_detail_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{
      cache_key: createCacheKey(organization, sourceUrl),
      organization,
      source_url: sourceUrl,
      content,
      status: 'success',
      extractor_version: REPORT_DETAIL_EXTRACTOR_VERSION,
      extracted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`write failed: ${response.status}`);
}

export async function getCachedOrExtractReportDetail(
  organization: string,
  rawUrl: string,
  extract: () => Promise<string>,
): Promise<{ content: string; cacheState: 'hit' | 'miss' }> {
  const sourceUrl = normalizeDetailSourceUrl(rawUrl);
  const cached = await readDetailCache(organization, sourceUrl);
  if (cached) {
    console.info(`[report-detail-cache] hit organization=${organization} updatedAt=${cached.updatedAt}`);
    return { content: cached.content, cacheState: 'hit' };
  }

  const cacheKey = createCacheKey(organization, sourceUrl);
  const inFlight = cache.inFlight?.get(cacheKey);
  if (inFlight) return { content: await inFlight, cacheState: 'miss' };

  console.info(`[report-detail-cache] miss organization=${organization}`);
  const pending = extract()
    .then(async (content) => {
      if (!content.trim()) return content;
      try {
        await writeDetailCache(organization, sourceUrl, content);
      } catch (error) {
        console.warn('[report-detail-cache] write failed; returning extracted content:', error);
      }
      return content;
    })
    .finally(() => cache.inFlight?.delete(cacheKey));
  cache.inFlight?.set(cacheKey, pending);
  return { content: await pending, cacheState: 'miss' };
}
