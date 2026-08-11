import { fetchFscResearchReports } from '@/lib/scrapers/fsc-research';
import { fetchFssResearchReports } from '@/lib/scrapers/fss-research';
import { fetchHanaResearchReports } from '@/lib/scrapers/hana-research';
import { fetchKbResearchReports } from '@/lib/scrapers/kb-research';
import { fetchWfriResearchReports } from '@/lib/scrapers/wfri-research';
import { fetchKifResearchReports } from '@/lib/scrapers/kif-research';
import { fetchKdbResearchReports } from '@/lib/scrapers/kdb-research';
import { fetchKoreaBankReports } from '@/lib/scrapers/bok-research';
import { fetchKdiReports } from '@/lib/scrapers/kdi-research';
import { fetchMotieReports } from '@/lib/scrapers/motie-research';
import { fetchMssReports } from '@/lib/scrapers/mss-research';
import { fetchKietResearchReports } from '@/lib/scrapers/kiet-research';
import { fetchMofePressReleases } from '@/lib/scrapers/mofe-research';
import { fetchEyResearchReports } from '@/lib/scrapers/ey-research';
import { fetchMpbPressReleases } from '@/lib/scrapers/mpb-research';
import { Report } from '@/types/report';

export interface ScraperDefinition {
  id: string;
  organization: string;
  fetchReports: () => Promise<Report[]>;
}

export interface ScraperCollectionResult {
  organization: string;
  reports: Report[];
  error?: unknown;
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
  {
    id: 'bok',
    organization: '한국은행',
    fetchReports: fetchKoreaBankReports,
  },
  {
    id: 'kdi',
    organization: 'KDI(한국개발연구원)',
    fetchReports: fetchKdiReports,
  },
  {
    id: 'motie',
    organization: '산업통상자원부',
    fetchReports: fetchMotieReports,
  },
  {
    id: 'mss',
    organization: '중소벤처기업부',
    fetchReports: fetchMssReports,
  },
  {
    id: 'kiet',
    organization: 'KIET 산업연구원',
    fetchReports: fetchKietResearchReports,
  },
  {
    id: 'mofe',
    organization: '재정경제부',
    fetchReports: fetchMofePressReleases,
  },
  {
    id: 'ey',
    organization: 'EY한영',
    fetchReports: fetchEyResearchReports,
  },
  {
    id: 'mpb',
    organization: '기획예산처',
    fetchReports: fetchMpbPressReleases,
  },
];

export function getRegisteredOrganizations(): string[] {
  return scraperRegistry.map((scraper) => scraper.organization);
}

export async function collectReportsByOrganization(): Promise<ScraperCollectionResult[]> {
  const results = await Promise.allSettled(scraperRegistry.map((scraper) => scraper.fetchReports()));

  return results.map((result, index) => {
    const scraper = scraperRegistry[index];
    if (result.status === 'fulfilled') {
      return { organization: scraper.organization, reports: result.value };
    }

    console.error(`[${scraper.organization}] scraper failed:`, result.reason);
    return { organization: scraper.organization, reports: [], error: result.reason };
  });
}

export async function collectReportsFromScrapers(): Promise<Report[]> {
  const results = await collectReportsByOrganization();
  return results.flatMap((result) => result.reports);
}
