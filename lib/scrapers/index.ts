import { fetchFscResearchReports } from '@/lib/scrapers/fsc-research';
import { fetchFssResearchReports } from '@/lib/scrapers/fss-research';
import { fetchHanaResearchReports } from '@/lib/scrapers/hana-research';
import { fetchKbResearchReports } from '@/lib/scrapers/kb-research';
import { fetchWfriResearchReports } from '@/lib/scrapers/wfri-research';
import { fetchKifResearchReports } from '@/lib/scrapers/kif-research';
import { fetchKdbResearchReports } from '@/lib/scrapers/kdb-research';
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
  {
    id: 'wfri',
    organization: '우리금융경영연구소',
    fetchReports: fetchWfriResearchReports,
  },
  {
    id: 'kif',
    organization: '한국금융연구원',
    fetchReports: fetchKifResearchReports,
  },
  {
    id: 'kdb',
    organization: 'KDB미래전략연구소',
    fetchReports: fetchKdbResearchReports,
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
