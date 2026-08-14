'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { SharedReport, SharedReportInput } from '@/types/shared-report';

const EMPTY_FORM: SharedReportInput = {
  title: '',
  organization: '',
  published_at: '',
  url: '',
};

type AdminAction = { type: 'edit' | 'delete'; report: SharedReport };

function formatDate(date: string): string {
  return date.replace(/-/g, '.');
}

export function SharedReportsSection({ searchQuery }: { searchQuery: string }) {
  const [reports, setReports] = useState<SharedReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<SharedReport | null>(null);
  const [form, setForm] = useState<SharedReportInput>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAuthorizing, setIsAuthorizing] = useState(false);

  const loadReports = async () => {
    setIsLoading(true);
    setListError('');
    try {
      const response = await fetch('/api/shared-reports', { cache: 'no-store' });
      const payload = await response.json() as SharedReport[] | { message?: string };
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error('message' in payload ? payload.message : '공유 보고서를 불러오지 못했습니다.');
      }
      setReports(payload);
      setListError('');
    } catch (loadError) {
      setListError(loadError instanceof Error ? loadError.message : '공유 보고서를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const visibleReports = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) =>
      report.title.toLowerCase().includes(keyword) || report.organization.toLowerCase().includes(keyword),
    );
  }, [reports, searchQuery]);

  const openCreateForm = () => {
    setEditingReport(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsFormOpen(true);
  };

  const openEditForm = (report: SharedReport) => {
    setEditingReport(report);
    setForm({
      title: report.title,
      organization: report.organization,
      published_at: report.published_at,
      url: report.url,
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const saveReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setFormError('');
    try {
      const endpoint = editingReport ? `/api/shared-reports/${editingReport.id}` : '/api/shared-reports';
      const response = await fetch(endpoint, {
        method: editingReport ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingReport ? { ...form, admin_password: adminPassword } : form),
      });
      const payload = await response.json() as SharedReport | { message?: string };
      if (!response.ok || !('id' in payload)) {
        throw new Error('message' in payload ? payload.message : '공유 보고서를 저장하지 못했습니다.');
      }

      setReports((current) => {
        const next = editingReport
          ? current.map((report) => report.id === payload.id ? payload : report)
          : [payload, ...current];
        return [...next].sort((left, right) => right.published_at.localeCompare(left.published_at));
      });
      setIsFormOpen(false);
      setEditingReport(null);
      setForm(EMPTY_FORM);
      setAdminPassword('');
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '공유 보고서를 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteReport = async (report: SharedReport, password: string): Promise<boolean> => {
    setPasswordError('');
    try {
      const response = await fetch(`/api/shared-reports/${report.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_password: password }),
      });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message || '공유 보고서를 삭제하지 못했습니다.');
      }
      setReports((current) => current.filter((item) => item.id !== report.id));
      return true;
    } catch (deleteError) {
      setPasswordError(deleteError instanceof Error ? deleteError.message : '공유 보고서를 삭제하지 못했습니다.');
      return false;
    }
  };

  const submitAdminPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminAction) return;

    setIsAuthorizing(true);
    setPasswordError('');
    try {
      const response = await fetch('/api/shared-reports/verify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_password: adminPassword }),
      });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message || '비밀번호가 올바르지 않습니다.');
      }

      if (adminAction.type === 'edit') {
        openEditForm(adminAction.report);
        setAdminAction(null);
        return;
      }

      const deleted = await deleteReport(adminAction.report, adminPassword);
      if (deleted) {
        setAdminAction(null);
        setAdminPassword('');
      }
    } catch (adminError) {
      setPasswordError(adminError instanceof Error ? adminError.message : '비밀번호가 올바르지 않습니다.');
    } finally {
      setIsAuthorizing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreateForm}
          className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 sm:text-sm"
        >
          + 보고서 등록
        </button>
      </div>

      {listError && <p className="text-sm text-rose-600">{listError}</p>}
      {isLoading ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden="true" />
          공유 보고서를 불러오는 중입니다...
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          공유된 보고서가 없습니다.
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleReports.map((report) => (
            <article key={report.id} className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">공유</span>
                    <span aria-hidden="true" className="text-xs text-slate-400">|</span>
                    <span className="rounded-full border border-transparent bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">{report.organization}</span>
                  </div>
                  <h4 className="break-words text-base font-semibold text-slate-900 sm:text-lg">{report.title}</h4>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                  <button type="button" onClick={() => { setAdminPassword(''); setPasswordError(''); setAdminAction({ type: 'edit', report }); }} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 sm:text-sm">수정</button>
                  <button type="button" onClick={() => { setAdminPassword(''); setPasswordError(''); setAdminAction({ type: 'delete', report }); }} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:text-rose-600 sm:text-sm">삭제</button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <a href={report.url} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 sm:text-sm">원문보기</a>
                <span className="text-xs text-slate-500 sm:text-sm">{formatDate(report.published_at)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-labelledby="shared-report-form-title">
          <form onSubmit={saveReport} className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <h3 id="shared-report-form-title" className="text-lg font-semibold text-slate-900">{editingReport ? '보고서 수정' : '보고서 등록'}</h3>
              <button type="button" onClick={() => setIsFormOpen(false)} className="text-sm text-slate-500 hover:text-slate-900">닫기</button>
            </div>
            {formError && <p className="text-sm text-rose-600">{formError}</p>}
            {(['title', 'organization', 'published_at', 'url'] as const).map((field) => (
              <label key={field} className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{{ title: '제목', organization: '제공기관', published_at: '발간일', url: '원문 링크(URL)' }[field]}</span>
                <input
                  required
                  type={field === 'published_at' ? 'date' : field === 'url' ? 'url' : 'text'}
                  value={form[field]}
                  onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setIsFormOpen(false)} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 sm:text-sm">취소</button>
              <button disabled={isSaving} type="submit" className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm">{isSaving ? '저장 중...' : '저장'}</button>
            </div>
          </form>
        </div>
      )}

      {adminAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-password-title">
          <form onSubmit={submitAdminPassword} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div>
              <h3 id="admin-password-title" className="text-lg font-semibold text-slate-900">관리자 비밀번호</h3>
              <p className="mt-1 text-sm text-slate-500">{adminAction.type === 'edit' ? '보고서를 수정하려면' : '보고서를 삭제하려면'} 비밀번호를 입력하세요.</p>
            </div>
            {passwordError && <p className="text-sm text-rose-600">{passwordError}</p>}
            <input
              autoFocus
              required
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAdminAction(null); setAdminPassword(''); setPasswordError(''); }} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 sm:text-sm">취소</button>
              <button disabled={isAuthorizing} type="submit" className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm">확인</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
