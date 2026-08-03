import { hasValidSharedReportsAdminPassword, isSharedReportsAdminPasswordConfigured } from '@/lib/shared-reports';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as { admin_password?: unknown } | null;
  if (!isSharedReportsAdminPasswordConfigured()) {
    return NextResponse.json({
      message: '공유 보고서 관리자 설정이 완료되지 않았습니다.',
      code: 'SHARED_REPORTS_CONFIGURATION_ERROR',
      missingEnvironmentVariables: ['SHARED_REPORT_ADMIN_PASSWORD'],
    }, { status: 503 });
  }
  if (!hasValidSharedReportsAdminPassword(payload?.admin_password)) {
    return NextResponse.json({ message: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
