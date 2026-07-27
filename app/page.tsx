'use client';

import { ReportList } from '@/components/report-list';
import { ReportFilterTabsClient } from '@/components/report-filter-tabs-client';
import { ReportSearchBarClient } from '@/components/report-search-bar-client';
import { getReportsForDisplay } from '@/lib/report-data';
import { FilterOption } from '@/types/report';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

function normalizeFilterValue(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function compareReportsByDate(left: { publishedAt: string; datePrecision?: 'day' | 'month' }, right: { publishedAt: string; datePrecision?: 'day' | 'month' }): number {
  const monthComparison = right.publishedAt.slice(0, 7).localeCompare(left.publishedAt.slice(0, 7));
  if (monthComparison !== 0) return monthComparison;

  const leftPrecision = left.datePrecision ?? 'day';
  const rightPrecision = right.datePrecision ?? 'day';
  if (leftPrecision !== rightPrecision) return leftPrecision === 'month' ? 1 : -1;

  return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
}

const FILTER_ORDER = [
  'KB경영연구소',
  '하나금융연구소',
  '우리금융경영연구소',
  'KDB미래전략연구소',
  '한국금융연구원',
  '금융위원회',
  '금융감독원',
];

type ReportTypeFilter = '전체' | '연구보고서' | '보도자료';

export default function HomePage() {
  const [reports, setReports] = useState<any[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterOption>('전체');
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>(['전체']);
  const [selectedReportType, setSelectedReportType] = useState<ReportTypeFilter>('전체');

  useEffect(() => {
    async function loadOrganizations() {
      try {
        const response = await fetch('/api/reports/organizations', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to load organizations');
        }

        const organizations = (await response.json()) as string[];
        const orderedOrganizations = [
          ...FILTER_ORDER.filter((organization) => organizations.includes(organization)),
          ...organizations.filter((organization) => !FILTER_ORDER.includes(organization)),
        ];
        setFilterOptions(['전체', ...orderedOrganizations] as FilterOption[]);
      } catch (error) {
        console.error(error);
        setFilterOptions(['전체'] as FilterOption[]);
      }
    }

    loadOrganizations();
  }, []);

  useEffect(() => {
    async function loadReports() {
      try {
        const data = await getReportsForDisplay();
        setReports(data);
      } finally {
        setIsLoadingReports(false);
      }
    }

    loadReports();
  }, []);

  const filteredReports = useMemo(() => {
    const normalizedSelectedFilter = normalizeFilterValue(selectedFilter);

    const matchedReports = reports.filter((report) => {
      const matchesFilter =
        selectedFilter === '전체' || normalizeFilterValue(report.organization) === normalizedSelectedFilter;
      const matchesReportType =
        selectedFilter !== '전체' ||
        selectedReportType === '전체' ||
        (selectedReportType === '보도자료'
          ? report.category === '보도자료'
          : report.category !== '보도자료');

      const keyword = searchQuery.trim().toLowerCase();
      const matchesSearch =
        keyword.length === 0 ||
        report.title.toLowerCase().includes(keyword) ||
        report.organization.toLowerCase().includes(keyword);

      return matchesFilter && matchesReportType && matchesSearch;
    });

    return selectedFilter === '전체'
      ? matchedReports.sort(compareReportsByDate)
      : matchedReports;
  }, [reports, searchQuery, selectedFilter, selectedReportType]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="relative rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="max-w-[38rem]">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
                DISCOVER INSIGHTS, INSPIRE RESEARCH.
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Research Hub
              </h1>
            </div>

            <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
              여러 연구기관의 최신 보고서를 한곳에서 모아보고,<br />
              최신 연구 동향을 빠르게 확인하세요.
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">보고서 목록</h2>
              <p className="text-sm text-slate-500">
                연구보고서는 최근 4주, 보도자료는 최근 2주 이내 자료를 제공합니다.
              </p>
            </div>
            <ReportFilterTabsClient
              options={filterOptions}
              selected={selectedFilter}
              onSelect={(option) => {
                setSelectedFilter(option);
                setSelectedReportType('전체');
              }}
            />
            {selectedFilter === '전체' && (
              <div className="-mt-1 flex flex-col items-start gap-2">
                <span className="text-sm font-medium text-slate-500">Category</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['전체', '연구보고서', '보도자료'] as ReportTypeFilter[]).map((type) => {
                    const isActive = type === selectedReportType;
                    const categoryButtonClass = type === '연구보고서'
                      ? isActive
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-50'
                      : type === '보도자료'
                        ? isActive
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                        : isActive
                          ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900';
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedReportType(type)}
                        className={`rounded-full border px-3 py-1 text-[13px] font-medium transition ${categoryButtonClass}`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <ReportList reports={filteredReports} isLoading={isLoadingReports} />
        </section>
      </div>
    </main>
  );
}
