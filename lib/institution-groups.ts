export const INSTITUTION_GROUPS = {
  정부기관: [
    { organization: '금융위원회', label: '금융위원회' },
    { organization: '금융감독원', label: '금융감독원' },
    { organization: '산업통상자원부', label: '산업통상부' },
    { organization: '중소벤처기업부', label: '중소벤처기업부' },
    { organization: '재정경제부', label: '재정경제부' },
  ],
  정책연구기관: [
    { organization: '한국은행', label: '한국은행' },
    { organization: 'KDI(한국개발연구원)', label: 'KDI' },
    { organization: 'KDB미래전략연구소', label: 'KDB미래전략연구소' },
    { organization: '한국금융연구원', label: '한국금융연구원' },
    { organization: 'KIET 산업연구원', label: 'KIET 산업연구원' },
  ],
  민간연구기관: [
    { organization: 'KB경영연구소', label: 'KB경영연구소' },
    { organization: '하나금융연구소', label: '하나금융연구소' },
    { organization: '우리금융경영연구소', label: '우리금융경영연구소' },
  ],
  기타: [
    { organization: 'EY한영', label: 'EY한영' },
    { organization: '공유 보고서', label: '공유 보고서' },
  ],
} as const;

export type InstitutionGroup = '전체' | keyof typeof INSTITUTION_GROUPS;

export const INSTITUTION_GROUP_OPTIONS = [
  { value: '전체', label: '전체' },
  ...Object.keys(INSTITUTION_GROUPS).map((group) => ({ value: group, label: group })),
] as Array<{ value: InstitutionGroup; label: string }>;

export function getAllInstitutions(): string[] {
  return Object.values(INSTITUTION_GROUPS).flatMap((institutions) =>
    institutions.map(({ organization }) => organization),
  );
}

export function getInstitutionsForGroup(group: InstitutionGroup) {
  if (group === '전체') {
    return Object.values(INSTITUTION_GROUPS).flat();
  }

  return INSTITUTION_GROUPS[group];
}

export function getOrganizationNamesForGroup(group: InstitutionGroup): string[] {
  return getInstitutionsForGroup(group).map(({ organization }) => organization);
}

export function getInstitutionGroup(organization: string): InstitutionGroup | undefined {
  return (Object.keys(INSTITUTION_GROUPS) as Array<keyof typeof INSTITUTION_GROUPS>)
    .find((group) => INSTITUTION_GROUPS[group].some((institution) => institution.organization === organization));
}

export function getInstitutionDisplayName(organization: string): string {
  return getInstitutionsForGroup('전체')
    .find((institution) => institution.organization === organization)?.label ?? organization;
}
