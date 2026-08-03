import { SharedReport, SharedReportInput } from '@/types/shared-report';

const REQUIRED_ENVIRONMENT_VARIABLES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SHARED_REPORT_ADMIN_PASSWORD',
] as const;

const TITLE_MAX_LENGTH = 500;
const ORGANIZATION_MAX_LENGTH = 200;
const URL_MAX_LENGTH = 2048;

type SharedReportsErrorCode =
  | 'SHARED_REPORTS_CONFIGURATION_ERROR'
  | 'SUPABASE_AUTHENTICATION_FAILED'
  | 'SUPABASE_PERMISSION_DENIED'
  | 'SUPABASE_RESOURCE_NOT_FOUND'
  | 'SUPABASE_DUPLICATE_URL'
  | 'SUPABASE_NETWORK_ERROR'
  | 'SUPABASE_REQUEST_FAILED';

export class SharedReportsError extends Error {
  constructor(
    public readonly code: SharedReportsErrorCode,
    message: string,
    public readonly upstreamStatus?: number,
    public readonly missingEnvironmentVariables?: string[],
  ) {
    super(message);
  }
}

function getMissingEnvironmentVariables(): string[] {
  return REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => !process.env[name]);
}

function getSupabaseConfig() {
  const missingEnvironmentVariables = getMissingEnvironmentVariables().filter(
    (name) => name !== 'SHARED_REPORT_ADMIN_PASSWORD',
  );
  if (missingEnvironmentVariables.length > 0) {
    throw new SharedReportsError(
      'SHARED_REPORTS_CONFIGURATION_ERROR',
      `Missing environment variables: ${missingEnvironmentVariables.join(', ')}`,
      undefined,
      missingEnvironmentVariables,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  return { url: url.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceRoleKey };
}

function getSafeSupabaseMessage(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return [parsed.code, parsed.message, parsed.details, parsed.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ')
      .slice(0, 500);
  } catch {
    return errorText.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
}

function createSupabaseError(status: number, errorText: string): SharedReportsError {
  const safeMessage = getSafeSupabaseMessage(errorText) || 'No error body returned';
  if (status === 401) return new SharedReportsError('SUPABASE_AUTHENTICATION_FAILED', safeMessage, status);
  if (status === 403) return new SharedReportsError('SUPABASE_PERMISSION_DENIED', safeMessage, status);
  if (status === 404) return new SharedReportsError('SUPABASE_RESOURCE_NOT_FOUND', safeMessage, status);
  if (status === 409 || /duplicate key|unique constraint|\b23505\b/i.test(safeMessage)) {
    return new SharedReportsError('SUPABASE_DUPLICATE_URL', safeMessage, status);
  }
  return new SharedReportsError('SUPABASE_REQUEST_FAILED', safeMessage, status);
}

async function requestSharedReports<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const requestUrl = `${url}/rest/v1/shared_reports${path}`;

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 300) : 'Unknown network error';
    console.error('[shared-reports] Supabase network request failed:', safeMessage);
    throw new SharedReportsError('SUPABASE_NETWORK_ERROR', safeMessage);
  }

  if (!response.ok) {
    const error = createSupabaseError(response.status, await response.text());
    console.error('[shared-reports] Supabase request failed:', {
      code: error.code,
      status: error.upstreamStatus,
      message: error.message,
    });
    throw error;
  }

  return response.json() as Promise<T>;
}

export function parseSharedReportInput(value: unknown): { input?: SharedReportInput; message?: string } {
  if (!value || typeof value !== 'object') return { message: '요청 본문이 올바르지 않습니다.' };

  const { title, organization, published_at: publishedAt, url } = value as Record<string, unknown>;
  if (typeof title !== 'string' || typeof organization !== 'string' || typeof publishedAt !== 'string' || typeof url !== 'string') {
    return { message: '제목, 제공기관, 발간일, 원문 링크는 필수입니다.' };
  }

  const normalizedTitle = title.trim();
  const normalizedOrganization = organization.trim();
  const normalizedPublishedAt = publishedAt.trim();
  const normalizedUrl = url.trim();
  if (!normalizedTitle || !normalizedOrganization || !normalizedPublishedAt || !normalizedUrl) {
    return { message: '제목, 제공기관, 발간일, 원문 링크는 필수입니다.' };
  }
  if (normalizedTitle.length > TITLE_MAX_LENGTH) return { message: `제목은 ${TITLE_MAX_LENGTH}자 이하여야 합니다.` };
  if (normalizedOrganization.length > ORGANIZATION_MAX_LENGTH) return { message: `제공기관은 ${ORGANIZATION_MAX_LENGTH}자 이하여야 합니다.` };
  if (normalizedUrl.length > URL_MAX_LENGTH) return { message: `원문 링크는 ${URL_MAX_LENGTH}자 이하여야 합니다.` };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedPublishedAt)) return { message: '발간일은 YYYY-MM-DD 형식이어야 합니다.' };
  const [year, month, day] = normalizedPublishedAt.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return { message: '발간일이 올바른 날짜가 아닙니다.' };
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return { message: '원문 링크는 http 또는 https URL이어야 합니다.' };
    return {
      input: {
        title: normalizedTitle,
        organization: normalizedOrganization,
        published_at: normalizedPublishedAt,
        url: parsedUrl.toString(),
      },
    };
  } catch {
    return { message: '원문 링크가 올바른 URL이 아닙니다.' };
  }
}

export function getSharedReportsErrorResponse(error: unknown): {
  status: number;
  body: { message: string; code: string; missingEnvironmentVariables?: string[] };
} | null {
  if (!(error instanceof SharedReportsError)) return null;

  if (error.code === 'SHARED_REPORTS_CONFIGURATION_ERROR') {
    return {
      status: 503,
      body: {
        message: '공유 보고서 서버 설정이 완료되지 않았습니다.',
        code: error.code,
        missingEnvironmentVariables: error.missingEnvironmentVariables,
      },
    };
  }
  if (error.code === 'SUPABASE_DUPLICATE_URL') {
    return { status: 409, body: { message: '같은 원문 링크가 이미 등록되어 있습니다.', code: error.code } };
  }
  if (error.code === 'SUPABASE_NETWORK_ERROR') {
    return { status: 503, body: { message: '공유 보고서 데이터베이스에 연결할 수 없습니다.', code: error.code } };
  }
  return { status: 503, body: { message: '공유 보고서 데이터베이스 설정 또는 권한을 확인해주세요.', code: error.code } };
}

export async function getSharedReportsHealth(): Promise<{
  configured: boolean;
  databaseReachable: boolean;
  missingEnvironmentVariables?: string[];
  errorCode?: string;
}> {
  const missingEnvironmentVariables = getMissingEnvironmentVariables();
  const hasSupabaseConfig = !missingEnvironmentVariables.some((name) =>
    name === 'NEXT_PUBLIC_SUPABASE_URL' || name === 'SUPABASE_SERVICE_ROLE_KEY',
  );

  if (!hasSupabaseConfig) {
    return { configured: false, databaseReachable: false, missingEnvironmentVariables };
  }

  try {
    await requestSharedReports<Array<{ id: string }>>('?select=id&limit=1');
    return {
      configured: missingEnvironmentVariables.length === 0,
      databaseReachable: true,
      ...(missingEnvironmentVariables.length > 0 ? { missingEnvironmentVariables } : {}),
    };
  } catch (error) {
    return {
      configured: missingEnvironmentVariables.length === 0,
      databaseReachable: false,
      ...(missingEnvironmentVariables.length > 0 ? { missingEnvironmentVariables } : {}),
      ...(error instanceof SharedReportsError ? { errorCode: error.code } : { errorCode: 'SUPABASE_REQUEST_FAILED' }),
    };
  }
}

export function isSharedReportsAdminPasswordConfigured(): boolean {
  return Boolean(process.env.SHARED_REPORT_ADMIN_PASSWORD);
}

export function hasValidSharedReportsAdminPassword(value: unknown): boolean {
  return typeof value === 'string' &&
    isSharedReportsAdminPasswordConfigured() &&
    value === process.env.SHARED_REPORT_ADMIN_PASSWORD;
}

export async function listSharedReports(): Promise<SharedReport[]> {
  return requestSharedReports<SharedReport[]>('?select=*&order=published_at.desc,created_at.desc');
}

async function ensureUrlIsAvailable(url: string, excludedId?: string): Promise<void> {
  const filters = new URLSearchParams({ select: 'id', url: `eq.${url}`, limit: '1' });
  if (excludedId) filters.set('id', `neq.${excludedId}`);

  const existingReports = await requestSharedReports<Array<{ id: string }>>(`?${filters.toString()}`);
  if (existingReports.length > 0) {
    throw new SharedReportsError('SUPABASE_DUPLICATE_URL', 'A report with the same URL already exists.');
  }
}

export async function createSharedReport(input: SharedReportInput): Promise<SharedReport> {
  await ensureUrlIsAvailable(input.url);
  const reports = await requestSharedReports<SharedReport[]>('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(input),
  });
  return reports[0];
}

export async function updateSharedReport(id: string, input: SharedReportInput): Promise<SharedReport> {
  await ensureUrlIsAvailable(input.url, id);
  const reports = await requestSharedReports<SharedReport[]>(`?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(input),
  });
  return reports[0];
}

export async function deleteSharedReport(id: string): Promise<void> {
  await requestSharedReports<SharedReport[]>(`?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
}
