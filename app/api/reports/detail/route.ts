import { fetchReportDetail } from '@/lib/report-detail';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const organization = request.nextUrl.searchParams.get('organization') || '';
  const url = request.nextUrl.searchParams.get('url') || '';

  try {
    const content = await fetchReportDetail(organization, url);
    return NextResponse.json({ content });
  } catch (error) {
    console.error('Report detail fetch failed:', error);
    return NextResponse.json({ message: '상세 내용을 불러오지 못했습니다.' }, { status: 400 });
  }
}
