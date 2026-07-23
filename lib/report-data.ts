import { reports as fallbackReports } from '@/data/reports';
import { Report } from '@/types/report';

export async function getReportsForDisplay(): Promise<Report[]> {
  try {
    const response = await fetch('/api/reports', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Failed to load reports from API');
    }

    const data = (await response.json()) as Report[];
    return data.length > 0 ? data : fallbackReports;
  } catch (error) {
    console.error(error);
    return fallbackReports;
  }
}
