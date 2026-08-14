'use client';

import { ReportList } from '@/components/report-list';
import { ReportFilterTabsClient } from '@/components/report-filter-tabs-client';
import { ReportSearchBarClient } from '@/components/report-search-bar-client';
import { SharedReportsSection } from '@/components/shared-reports-section';
import {
  getInstitutionDisplayName,
  getOrganizationNamesForGroup,
  INSTITUTION_GROUP_OPTIONS,
  InstitutionGroup,
} from '@/lib/institution-groups';
import { getReportsForDisplay } from '@/lib/report-data';
import { Report } from '@/types/report';
import { SharedReport, toDisplayReport } from '@/types/shared-report';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

const REPORT_POLL_INTERVAL_MS = 3_000;
const REPORT_POLL_MAX_DURATION_MS = 30_000;

function normalizeFilterValue(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function compareReportsByDate(left: { publishedAt: string; datePrecision?: 'day' | 'month'; firstSeenAt?: string }, right: { publishedAt: string; datePrecision?: 'day' | 'month'; firstSeenAt?: string }): number {
  const monthComparison = right.publishedAt.slice(0, 7).localeCompare(left.publishedAt.slice(0, 7));
  if (monthComparison !== 0) return monthComparison;

  const leftPrecision = left.datePrecision ?? 'day';
  const rightPrecision = right.datePrecision ?? 'day';
  if (leftPrecision !== rightPrecision) return leftPrecision === 'month' ? 1 : -1;

  const dateComparison = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  if (dateComparison !== 0) return dateComparison;

  if (left.firstSeenAt && right.firstSeenAt) {
    return new Date(right.firstSeenAt).getTime() - new Date(left.firstSeenAt).getTime();
  }
  if (left.firstSeenAt) return -1;
  if (right.firstSeenAt) return 1;
  return 0;
}

function reportIdentity(report: Report): string {
  return report.url
    ? `${report.organization}:url:${report.url}`
    : `${report.organization}:id:${report.id}:${report.title}:${report.publishedAt}`;
}

function countNewReports(currentReports: Report[], latestReports: Report[]): number {
  const currentKeys = new Set(currentReports.map(reportIdentity));
  return latestReports.filter((report) => !currentKeys.has(reportIdentity(report))).length;
}

type ReportTypeFilter = '전체' | '연구보고서' | '보도자료';

export default function HomePage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [pendingReports, setPendingReports] = useState<Report[] | null>(null);
  const [newReportCount, setNewReportCount] = useState(0);
  const [isRefreshingLatestReports, setIsRefreshingLatestReports] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<InstitutionGroup>('전체');
  const [selectedInstitution, setSelectedInstitution] = useState('전체');
  const [selectedReportType, setSelectedReportType] = useState<ReportTypeFilter>('전체');
  const [sharedReports, setSharedReports] = useState<SharedReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadReports() {
      try {
        const initialResult = await getReportsForDisplay();
        if (cancelled) return;

        setReports([...initialResult.reports]);

        if (initialResult.cacheState !== 'stale') return;

        const pollingStartedAt = Date.now();
        const pollForFreshReports = async () => {
          if (cancelled || Date.now() - pollingStartedAt >= REPORT_POLL_MAX_DURATION_MS) return;

          const latestResult = await getReportsForDisplay();
          if (cancelled) return;

          if (latestResult.cacheState === 'fresh') {
            const addedReportCount = countNewReports(initialResult.reports, latestResult.reports);
            if (addedReportCount > 0) {
              setPendingReports([...latestResult.reports]);
              setNewReportCount(addedReportCount);
            }
            return;
          }

          if (Date.now() - pollingStartedAt < REPORT_POLL_MAX_DURATION_MS) {
            pollTimer = setTimeout(pollForFreshReports, REPORT_POLL_INTERVAL_MS);
          }
        };

        pollTimer = setTimeout(pollForFreshReports, REPORT_POLL_INTERVAL_MS);
      } finally {
        if (!cancelled) setIsLoadingReports(false);
      }
    }

    loadReports();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/shared-reports', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as SharedReport[] | { message?: string };
        if (!response.ok || !Array.isArray(payload)) throw new Error('Failed to load shared reports');
        if (!cancelled) setSharedReports(payload);
      })
      .catch(() => {
        // Shared reports are optional in the unified list. Keep general reports available on failure.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const showLatestReports = async () => {
    setIsRefreshingLatestReports(true);
    try {
      const response = await fetch('/api/reports', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to refresh reports: ${response.status}`);

      const latestReports = await response.json() as Report[];
      setReports([...latestReports]);
      setPendingReports(null);
      setNewReportCount(0);
      window.location.reload();
    } catch (error) {
      console.error('Failed to refresh latest reports:', error);
    } finally {
      setIsRefreshingLatestReports(false);
    }
  };

  const dismissLatestReports = () => {
    setPendingReports(null);
    setNewReportCount(0);
  };

  const filteredReports = useMemo(() => {
    const reportsForDisplay = reports;
    const groupOrganizations = getOrganizationNamesForGroup(selectedGroup);
    const reportsForSelectedGroup = selectedGroup === '전체'
      ? reportsForDisplay
      : reportsForDisplay.filter((report) =>
        groupOrganizations.includes(report.organization),
      );
    const reportsForSelectedInstitution = selectedInstitution === '전체'
      ? reportsForSelectedGroup
      : reportsForSelectedGroup.filter(
        (report) => normalizeFilterValue(report.organization) === normalizeFilterValue(selectedInstitution),
      );

    const matchedReports = reportsForSelectedInstitution.filter((report) => {
      const reportCategory = report.organization === '산업통상자원부' && report.category === '참고자료'
        ? '보도자료'
        : report.category;
      const matchesReportType =
        selectedReportType === '전체' ||
        (reportCategory !== '공유' && (selectedReportType === '보도자료'
          ? reportCategory === '보도자료'
          : reportCategory !== '보도자료'));

      const keyword = searchQuery.trim().toLowerCase();
      const matchesSearch =
        keyword.length === 0 ||
        report.title.toLowerCase().includes(keyword) ||
        report.organization.toLowerCase().includes(keyword);

      return matchesReportType && matchesSearch;
    });

    const sortedReports = [...matchedReports].sort(compareReportsByDate);

    return sortedReports;
  }, [reports, searchQuery, selectedGroup, selectedInstitution, selectedReportType, sharedReports]);

  const institutionOptions = useMemo(() => [
    { value: '전체', label: '전체' },
    ...getOrganizationNamesForGroup(selectedGroup).map((organization) => ({
      value: organization,
      label: getInstitutionDisplayName(organization),
    })),
  ], [selectedGroup]);

  const isSharedReportsSelected = selectedGroup === '공유 보고서';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:gap-8">
        <header className="relative rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="max-w-[38rem]">
            <div>
              <p className="text-[13px] font-medium tracking-normal text-slate-500 sm:text-[15px]">
                <Image
                  src="/ibk-symbol-only.png"
                  alt=""
                  width={16}
                  height={16}
                  className="mr-1 inline-block align-[-2px] md:hidden"
                />
                IBK경제연구소
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Research Hub
              </h1>
            </div>

            <p className="mt-3 max-w-2xl text-xs text-slate-600 sm:text-base">
              Discover Insight <br />
              여러 연구기관의 최신 보고서를 한 눈에 볼 수 있습니다.
            </p>
            <div className="mt-6 w-full max-w-[36rem]">
              <ReportSearchBarClient
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="보고서 제목 또는 기관명을 검색하세요"
              />
            </div>
          </div>
          <div className="absolute right-10 top-10 hidden md:block">
            <Image
              src="/ibk-symbol-only.png"
              alt="IBK경제연구소 심볼"
              width={68}
              height={68}
              className="opacity-90"
            />
          </div>
        </header>

        {pendingReports && newReportCount > 0 && (
          <div className="fixed left-1/2 top-6 z-[1000] flex w-[calc(100vw-2rem)] max-w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] sm:min-h-12 sm:w-fit sm:flex-row sm:items-center sm:gap-5 sm:px-9">
            <p className="text-center text-sm font-normal text-slate-700 sm:text-[15px]">
              <span className="mr-1 inline-block scale-[1.08]">📄</span> 최신 보고서 {newReportCount}건이 추가되었습니다.
            </p>
            <div className="flex w-full shrink-0 items-center justify-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={showLatestReports}
                disabled={isRefreshingLatestReports}
                className="rounded-lg bg-[#EAF2FF] px-3 py-1.5 text-xs font-medium text-[#2F67C8] transition-colors duration-200 hover:bg-[#DCEAFF] active:bg-[#CFE1FF] disabled:cursor-wait disabled:opacity-60 sm:text-sm"
              >
                {isRefreshingLatestReports ? '불러오는 중...' : '최신 목록 보기'}
              </button>
              <button
                type="button"
                onClick={dismissLatestReports}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="최신 보고서 알림 닫기"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-col gap-3 sm:gap-3.5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">보고서 목록</h2>
              <p className="text-[13px] font-normal text-slate-500 sm:text-sm">
                ⓘ 최근 4주 연구보고서 · 최근 2주 보도자료
              </p>
            </div>
            <ReportFilterTabsClient
              options={INSTITUTION_GROUP_OPTIONS}
              selected={selectedGroup}
              variant="group"
              onSelect={(group) => {
                setSelectedGroup(group as InstitutionGroup);
                setSelectedInstitution('전체');
                setSelectedReportType('전체');
              }}
            />
            <div className="-mt-1 mb-0 h-px w-full bg-slate-200/70" />
            <div className="flex min-h-[26px] w-full items-start">
              {selectedGroup !== '전체' && selectedGroup !== '공유 보고서' ? (
                <ReportFilterTabsClient
                  options={institutionOptions}
                  selected={selectedInstitution}
                  onSelect={setSelectedInstitution}
                  variant="institution"
                  showSeparators
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm sm:gap-x-3 sm:text-[15px]">
                {(['전체', '연구보고서', '보도자료'] as ReportTypeFilter[]).map((type, index, types) => {
                  const isActive = type === selectedReportType;
                  return (
                    <span key={type} className="flex items-center gap-x-2 sm:gap-x-3">
                      <button
                        type="button"
                        onClick={() => setSelectedReportType(type)}
                        className={`border-b-2 py-0.5 transition-colors duration-200 ${
                          isActive
                            ? 'border-[#2F67C8] font-semibold text-[#2F67C8]'
                            : 'border-transparent font-normal text-slate-500 hover:border-slate-400 hover:text-slate-800'
                        }`}
                      >
                        {type}
                      </button>
                      {index < types.length - 1 && (
                        <span aria-hidden="true" className="select-none text-slate-200">│</span>
                      )}
                    </span>
                  );
                })}
                </div>
              )}
            </div>
          </div>

          {isSharedReportsSelected ? (
            <SharedReportsSection searchQuery="" />
          ) : (
            <ReportList
              key={`${selectedGroup}:${selectedInstitution}`}
              reports={filteredReports}
              isLoading={isLoadingReports}
            />
          )}
        </section>
      </div>
    </main>
  );
}
