import { waitUntil } from '@vercel/functions';
import { getReportsWithStaleWhileRevalidate } from '@/lib/report-cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { reports, state, refreshPromise } = await getReportsWithStaleWhileRevalidate();
    if (refreshPromise) waitUntil(refreshPromise);

    return NextResponse.json(reports, {
      headers: {
        'X-Report-Cache': state,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}
