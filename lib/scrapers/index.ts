import { fetchFscResearchReports } from '@/lib/scrapers/fsc-research';
import { fetchFssResearchReports } from '@/lib/scrapers/fss-research';
import { fetchHanaResearchReports } from '@/lib/scrapers/hana-research';
import { fetchKbResearchReports } from '@/lib/scrapers/kb-research';
import { Report } from '@/types/report';

export interface ScraperDefinition {
  id: string;
  organization: string;
  fetchReports: () => Promise<Report[]>;
}

export const scraperRegistry: ScraperDefinition[] = [
  {
    id: 'kb',
    organization: 'KB경영연구소',
    fetchReports: fetchKbResearchReports,
  },
  {
    id: 'hana',
    organization: '하나금융연구소',
    fetchReports: fetchHanaResearchReports,
  },
  {
    id: 'fsc',
    organization: '금융위원회',
    fetchReports: fetchFscResearchReports,
  },
  {
    id: 'fss',
    organization: '금융감독원',
    fetchReports: fetchFssResearchReports,
  },
];

export function getRegisteredOrganizations(): string[] {
  return scraperRegistry.map((scraper) => scraper.organization);
}

export async function collectReportsFromScrapers(): Promise<Report[]> {
  const results = await Promise.allSettled(scraperRegistry.map((scraper) => scraper.fetchReports()));

  return results.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    console.error('Scraper failed:', result.reason);
    return [];
  });
}
