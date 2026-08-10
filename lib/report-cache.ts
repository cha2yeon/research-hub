import { collectReportsByOrganization } from '@/lib/scrapers';
import { Report } from '@/types/report';

const CACHE_KEY = 'reports';
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ReportCacheState = 'fresh' | 'stale' | 'empty' | 'refreshing';

export interface ReportsWithCacheState {
  reports: Report[];
  state: ReportCacheState;
  refreshPromise?: Promise<Report[]>;
}

interface CachedReports {
  reports: Report[];
  updatedAt: string;
}

interface RuntimeCache {
  entry?: CachedReports;
  refreshPromise?: Promise<Report[]>;
}

const runtime = globalThis as typeof globalThis & { __researchHubReportCache?: RuntimeCache };
const cache = runtime.__researchHubReportCache ?? (runtime.__researchHubReportCache = {});

function getSupabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  return { url: url.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceRoleKey };
}

function isFresh(entry: CachedReports): boolean {
  const age = Date.now() - new Date(entry.updatedAt).getTime();

  console.log({
    updatedAt: entry.updatedAt,
    age,
    ttl: CACHE_TTL_MS,
    fresh: age < CACHE_TTL_MS,
  });

  return age < CACHE_TTL_MS;
}

function reportKey(report: Report): string {
  if (report.url) return `${report.organization}:url:${report.url}`;
  if (report.id) return `${report.organization}:id:${report.id}`;
  return `${report.organization}:fallback:${report.title}:${report.publishedAt}`;
}

function sortReports(reports: Report[]): Report[] {
  return [...reports].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

function deduplicateReports(reports: Report[]): Report[] {
  const byKey = new Map<string, Report>();
  reports.forEach((report) => byKey.set(reportKey(report), report));
  return sortReports(Array.from(byKey.values()));
}

function replaceOrganizationReports(fresh: Report[]): Report[] {
  return deduplicateReports(fresh);
}

async function readPersistentCache(): Promise<CachedReports | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/rest/v1/report_cache?cache_key=eq.${CACHE_KEY}&select=reports,updated_at&limit=1`, {
    headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Report cache read failed: ${response.status}`);

  const rows = await response.json() as Array<{ reports?: unknown; updated_at?: string }>;
  const row = rows[0];
  if (!row || !Array.isArray(row.reports) || !row.updated_at) return null;
  return { reports: row.reports as Report[], updatedAt: row.updated_at };
}

async function writePersistentCache(entry: CachedReports): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;

  const response = await fetch(`${config.url}/rest/v1/report_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ cache_key: CACHE_KEY, reports: entry.reports, updated_at: entry.updatedAt }]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Report cache write failed: ${response.status}`);
}

async function getCachedReports(): Promise<CachedReports | null> {
  if (cache.entry) {
    console.info('[report-cache] memory cache hit', { updatedAt: cache.entry.updatedAt, reportCount: cache.entry.reports.length });
    return cache.entry;
  }

  if (!getSupabaseConfig()) {
    console.warn('[report-cache] persistent cache is unavailable because Supabase configuration is missing.');
    return null;
  }

  try {
    const entry = await readPersistentCache();
    if (entry) {
      cache.entry = entry;
      console.info('[report-cache] persistent cache hit', { updatedAt: entry.updatedAt, reportCount: entry.reports.length });
    } else {
      console.info('[report-cache] persistent cache miss');
    }
    return entry;
  } catch (error) {
    console.error('Report cache read failed; using in-memory cache only:', error);
    return null;
  }
}

async function refreshReports(previousReports: Report[]): Promise<Report[]> {
  const results = await collectReportsByOrganization();
  const previousByOrganization = new Map<string, Report[]>();
  previousReports.forEach((report) => {
    const organizationReports = previousByOrganization.get(report.organization) || [];
    organizationReports.push(report);
    previousByOrganization.set(report.organization, organizationReports);
  });

  const mergedByOrganization = new Map(previousByOrganization);
  let refreshedOrganizationCount = 0;

  for (const result of results) {
    const previous = previousByOrganization.get(result.organization) || [];
    if (result.error) {
      console.error(`[${result.organization}] refresh failed; retaining ${previous.length} cached reports:`, result.error);
      continue;
    }
    if (result.reports.length === 0) {
      console.error(`[${result.organization}] refresh returned no reports; retaining ${previous.length} cached reports.`);
      continue;
    }

    const replacement = replaceOrganizationReports(result.reports);
    refreshedOrganizationCount += 1;
    mergedByOrganization.set(result.organization, replacement);
    console.info(`[${result.organization}] cache refreshed: previous=${previous.length} fresh=${result.reports.length} final=${replacement.length}`);
  }

  const mergedReports = deduplicateReports(Array.from(mergedByOrganization.values()).flat());
  if (refreshedOrganizationCount === 0 || mergedReports.length === 0) {
    console.error('Report cache refresh produced no safe update; retaining existing cache.');
    return previousReports;
  }

  const entry = { reports: mergedReports, updatedAt: new Date().toISOString() };
  cache.entry = entry;
  console.info(`Report cache refresh completed: ${refreshedOrganizationCount} institutions, ${mergedReports.length} reports.`);
  try {
    await writePersistentCache(entry);
    console.info('[report-cache] persistent cache write completed', { updatedAt: entry.updatedAt, reportCount: entry.reports.length });
  } catch (error) {
    console.error('Report cache write failed; retaining in-memory cache:', error);
  }
  return mergedReports;
}

function startRefresh(previousReports: Report[]): Promise<Report[]> {
  if (!cache.refreshPromise) {
    console.info(`Report cache refresh started with ${previousReports.length} cached reports.`);
    cache.refreshPromise = refreshReports(previousReports)
      .catch((error) => {
        console.error('Report cache refresh failed:', error);
        return previousReports;
      })
      .finally(() => {
        cache.refreshPromise = undefined;
      });
  } else {
    console.info('[report-cache] refresh already in progress; reusing the existing promise.');
  }
  return cache.refreshPromise;
}

export async function getReportsWithStaleWhileRevalidate(): Promise<ReportsWithCacheState> {
  const entry = await getCachedReports();
  if (!entry) {
    const reports = await startRefresh([]);
    console.info('[report-cache] returning empty-cache refresh result', { reportCount: reports.length });
    return { reports, state: 'empty' };
  }

  if (isFresh(entry)) {
    console.info('[report-cache] returning fresh cache', { reportCount: entry.reports.length });
    return { reports: entry.reports, state: 'fresh' };
  }

  const state: ReportCacheState = cache.refreshPromise ? 'refreshing' : 'stale';
  const refreshPromise = startRefresh(entry.reports);
  console.info('[report-cache] returning stale cache and scheduling refresh', { state, reportCount: entry.reports.length });
  return { reports: entry.reports, state, refreshPromise };
}
