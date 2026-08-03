import {
  createSharedReport,
  getSharedReportsErrorResponse,
  getSharedReportsHealth,
  listSharedReports,
  parseSharedReportInput,
} from '@/lib/shared-reports';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const sharedReportsError = getSharedReportsErrorResponse(error);
  if (sharedReportsError) return NextResponse.json(sharedReportsError.body, { status: sharedReportsError.status });

  console.error('[shared-reports] API request failed:', error instanceof Error ? error.message : 'Unknown error');
  return NextResponse.json({ message: fallbackMessage, code: 'SHARED_REPORTS_API_ERROR' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('health') === '1') {
    return NextResponse.json(await getSharedReportsHealth());
  }

  try {
    return NextResponse.json(await listSharedReports());
  } catch (error) {
    return errorResponse(error, '공유 보고서를 불러오지 못했습니다.');
  }
}

export async function POST(request: NextRequest) {
  const parsed = parseSharedReportInput(await request.json().catch(() => null));
  if (!parsed.input) {
    return NextResponse.json({ message: parsed.message || '필수 입력값을 확인해주세요.', code: 'SHARED_REPORTS_VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    return NextResponse.json(await createSharedReport(parsed.input), { status: 201 });
  } catch (error) {
    return errorResponse(error, '공유 보고서를 등록하지 못했습니다.');
  }
}
