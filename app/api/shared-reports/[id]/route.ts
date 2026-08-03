import {
  deleteSharedReport,
  getSharedReportsErrorResponse,
  hasValidSharedReportsAdminPassword,
  isSharedReportsAdminPasswordConfigured,
  parseSharedReportInput,
  updateSharedReport,
} from '@/lib/shared-reports';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const sharedReportsError = getSharedReportsErrorResponse(error);
  if (sharedReportsError) return NextResponse.json(sharedReportsError.body, { status: sharedReportsError.status });

  console.error('[shared-reports] API request failed:', error instanceof Error ? error.message : 'Unknown error');
  return NextResponse.json({ message: fallbackMessage, code: 'SHARED_REPORTS_API_ERROR' }, { status: 500 });
}

function adminPasswordError(value: unknown): NextResponse | null {
  if (!isSharedReportsAdminPasswordConfigured()) {
    return NextResponse.json({
      message: '공유 보고서 관리자 설정이 완료되지 않았습니다.',
      code: 'SHARED_REPORTS_CONFIGURATION_ERROR',
      missingEnvironmentVariables: ['SHARED_REPORT_ADMIN_PASSWORD'],
    }, { status: 503 });
  }
  if (!hasValidSharedReportsAdminPassword(value)) {
    return NextResponse.json({ message: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = await request.json().catch(() => null);
  const parsed = parseSharedReportInput(payload);
  if (!parsed.input) {
    return NextResponse.json({ message: parsed.message || '필수 입력값을 확인해주세요.', code: 'SHARED_REPORTS_VALIDATION_ERROR' }, { status: 400 });
  }
  const passwordError = adminPasswordError((payload as Record<string, unknown> | null)?.admin_password);
  if (passwordError) return passwordError;

  try {
    return NextResponse.json(await updateSharedReport(params.id, parsed.input));
  } catch (error) {
    return errorResponse(error, '공유 보고서를 수정하지 못했습니다.');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const payload = await request.json().catch(() => null);
  const passwordError = adminPasswordError((payload as Record<string, unknown> | null)?.admin_password);
  if (passwordError) return passwordError;

  try {
    await deleteSharedReport(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, '공유 보고서를 삭제하지 못했습니다.');
  }
}
