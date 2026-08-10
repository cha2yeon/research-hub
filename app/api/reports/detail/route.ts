import { fetchReportDetail } from '@/lib/report-detail';
import { getCachedOrExtractReportDetail } from '@/lib/report-detail-cache';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const organization = request.nextUrl.searchParams.get('organization') || '';
  const url = request.nextUrl.searchParams.get('url') || '';

  try {
    const result = await getCachedOrExtractReportDetail(
      organization,
      url,
      () => fetchReportDetail(organization, url),
    );
    return NextResponse.json({ content: result.content }, { headers: { 'X-Report-Detail-Cache': result.cacheState } });
  } catch (error) {
    console.error('Report detail fetch failed:', error);
    return NextResponse.json({ message: '상세 내용을 불러오지 못했습니다.' }, { status: 400 });
  }
}
