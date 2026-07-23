import { collectReportsFromScrapers } from '@/lib/scrapers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const reports = await collectReportsFromScrapers();
    return NextResponse.json(reports);
  } catch (error) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}
