'use client';

interface PaginationControlsProps {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

function getPageNumbers(currentPage: number, totalPages: number): number[] {
  const maxVisiblePages = 10;
  const startPage = Math.max(1, Math.min(currentPage - 4, totalPages - maxVisiblePages + 1));
  const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
}

export function PaginationControls({
  currentPage,
  totalItems,
  pageSize = 20,
  onPageChange,
}: PaginationControlsProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1 pt-1" aria-label="보고서 페이지 이동">
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
      >
        이전
      </button>
      {getPageNumbers(currentPage, totalPages).map((page) => (
        <button
          key={page}
          type="button"
          onClick={() => onPageChange(page)}
          aria-current={page === currentPage ? 'page' : undefined}
          className={`min-w-8 rounded-lg px-2 py-1.5 text-xs font-medium transition sm:text-sm ${
            page === currentPage
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          {page}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
      >
        다음
      </button>
    </nav>
  );
}
