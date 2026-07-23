import { getRegisteredOrganizations } from '@/lib/scrapers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const organizations = getRegisteredOrganizations();
    return NextResponse.json(organizations);
  } catch (error) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}
