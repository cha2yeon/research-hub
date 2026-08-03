import { reports as fallbackReports } from '@/data/reports';
import { Report } from '@/types/report';

export type ReportCacheState = 'fresh' | 'stale' | 'refreshing' | 'empty' | null;

export interface ReportsForDisplayResult {
  reports: Report[];
  cacheState: ReportCacheState;
}

export async function getReportsForDisplay(): Promise<ReportsForDisplayResult> {
  try {
    const response = await fetch('/api/reports', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Failed to load reports from API');
    }

    const data = (await response.json()) as Report[];
    const cacheState = response.headers.get('X-Report-Cache') as ReportCacheState;
    return {
      reports: data.length > 0 ? data : fallbackReports,
      cacheState,
    };
  } catch (error) {
    console.error(error);
    return { reports: fallbackReports, cacheState: null };
  }
}
