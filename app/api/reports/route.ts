import { getReportsWithStaleWhileRevalidate } from '@/lib/report-cache';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { reports, state } = await getReportsWithStaleWhileRevalidate();
    return NextResponse.json(reports, {
      headers: { 'X-Report-Cache': state },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}
