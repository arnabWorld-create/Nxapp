'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type ImportRecord = {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  createdAt: string;
  failureStage: string | null;
  failureMessage: string | null;
  failedAt: string | null;
  uploadedBy: { id: string; name: string; email: string } | null;
  aggregates: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    reviewRequiredRows: number;
    duplicateRows: number;
    dataRows: number;
    summaryRows: number;
    nonDataRows: number;
    confirmedMappingRows: number;
    commitEligibleRows: number;
  };
  statement: { id: string; fileName: string; status: string; periodStartDate: string; periodEndDate: string; distributor: { id: string; name: string } | null } | null;
};

const STATUS_COLORS: Record<string, string> = {
  UPLOADED: 'bg-blue-900/20 text-blue-300',
  PROCESSING: 'bg-yellow-900/20 text-yellow-300',
  READY_FOR_REVIEW: 'bg-purple-900/20 text-purple-300',
  COMMITTED: 'bg-green-900/20 text-green-300',
  FAILED: 'bg-red-900/20 text-red-300',
  CANCELLED: 'bg-slate-800 text-slate-300',
};

export default function ImportsPage() {
  const router = useRouter();
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImportRecord | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchImports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const response = await fetch(`/api/imports?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load import history');
      setImports(data.imports);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load import history');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status]);

  useEffect(() => { fetchImports(); }, [fetchImports]);

  const updateSearch = (value: string) => { setSearch(value); setPage(1); };
  const updateStatus = (value: string) => { setStatus(value); setPage(1); };

  const retryImport = async (importId: string) => {
    setRetryingId(importId);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/imports/${importId}/retry`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Retry failed');
      setActionMessage('Import retry completed and is ready for review.');
      await fetchImports();
    } catch (retryError) {
      setActionMessage(retryError instanceof Error ? retryError.message : 'Retry failed');
    } finally { setRetryingId(null); }
  };

  const deleteImport = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/imports/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Delete failed');
      setActionMessage(data.storageWarning || `Deleted ${data.fileName}.`);
      setDeleteTarget(null);
      await fetchImports();
    } catch (deleteError) {
      setActionMessage(deleteError instanceof Error ? deleteError.message : 'Delete failed');
    } finally { setDeletingId(null); }
  };

  return (
    <main className="page-frame operational-page">
      <div className="mx-auto max-w-[1600px]">
        <div className="page-header">
          <div>
            <div><p className="eyebrow">Data operations</p><h1>Import History</h1><p className="page-subtitle">Review uploaded files, processing progress, and committed statements.</p></div>
          </div>
          <button onClick={() => router.push('/import')} className="primary-action">New Import</button>
        </div>

        <div className="filter-surface operational-filter import-filter">
          <label className="text-sm text-slate-300">Search filename
            <input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search imports..." className="filter-control mt-2" />
          </label>
          <label className="text-sm text-slate-300">Status
            <select value={status} onChange={(event) => updateStatus(event.target.value)} className="filter-control mt-2">
              <option value="">All statuses</option><option value="UPLOADED">Uploaded</option><option value="PROCESSING">Processing</option><option value="READY_FOR_REVIEW">Ready for review</option><option value="COMMITTED">Committed</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <div className="flex items-end"><button onClick={() => { updateSearch(''); updateStatus(''); }} className="secondary-action">Clear filters</button></div>
        </div>
        {actionMessage && <div className="mb-5 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">{actionMessage}</div>}

        {loading ? <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">Loading import history...</div> : error ? <div className="rounded-lg border border-red-800 bg-red-900/20 p-5 text-red-300">{error}</div> : imports.length === 0 ? <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">No imports found.</div> : (
          <div className="surface operational-table">
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1500px]">
                <thead><tr className="border-b border-slate-700 bg-slate-800 text-left text-slate-300">
                  <th className="px-4 py-3">File</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Uploaded By</th><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3 text-right">Rows</th><th className="px-4 py-3 text-right">Valid</th><th className="px-4 py-3 text-right">Invalid</th><th className="px-4 py-3 text-right">Review</th><th className="px-4 py-3 text-right">Duplicates</th><th className="px-4 py-3">Summary / Non-data</th><th className="px-4 py-3">Mapping</th><th className="px-4 py-3">Statement</th><th className="px-4 py-3 text-center">Actions</th>
                </tr></thead>
                <tbody>{imports.map((item) => <tr key={item.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="max-w-xs px-4 py-3"><p className="truncate font-medium text-slate-100" title={item.fileName}>{item.fileName}</p><p className="text-xs text-slate-500">{item.fileType}</p></td>
                  <td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-slate-800 text-slate-300'}`}>{item.status}</span></td>
                  <td className="px-4 py-3"><p className="text-slate-200">{item.uploadedBy?.name || '—'}</p><p className="text-xs text-slate-500">{item.uploadedBy?.email || '—'}</p></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{item.aggregates.totalRows}</td><td className="px-4 py-3 text-right text-green-300">{item.aggregates.validRows}</td><td className="px-4 py-3 text-right text-red-300">{item.aggregates.invalidRows}</td><td className="px-4 py-3 text-right text-yellow-300">{item.aggregates.reviewRequiredRows}</td><td className="px-4 py-3 text-right text-orange-300">{item.aggregates.duplicateRows}</td>
                  <td className="px-4 py-3 text-slate-300">{item.aggregates.summaryRows} / {item.aggregates.nonDataRows}</td>
                  <td className="px-4 py-3 text-slate-300">{item.aggregates.confirmedMappingRows} confirmed<p className="text-xs text-slate-500">{item.aggregates.commitEligibleRows} eligible</p></td>
                  <td className="px-4 py-3 text-slate-300">{item.statement ? <><button onClick={() => router.push(`/statements/${item.statement?.id}`)} className="text-blue-400 hover:text-blue-300">{item.statement.status}</button><p className="text-xs text-slate-500">{item.statement.distributor?.name || 'Legacy statement'}</p></> : '—'}</td>
                  <td className="min-w-28 px-4 py-3"><div className="mx-auto flex w-24 flex-col items-stretch gap-2"><button onClick={() => router.push(item.status === 'COMMITTED' && item.statement ? `/statements/${item.statement.id}` : `/import/${item.id}/review`)} className="import-action-button flex w-full justify-center">{item.status === 'COMMITTED' ? 'View' : item.status === 'READY_FOR_REVIEW' ? 'Review' : 'Open Review'}</button>{item.status === 'FAILED' && <><p className="max-w-48 text-xs text-red-300">{item.failureStage || 'Processing failed'}: {item.failureMessage || 'No failure details available'}</p><button onClick={() => retryImport(item.id)} disabled={retryingId === item.id} className="import-retry-button">{retryingId === item.id ? 'Retrying...' : 'Retry'}</button></>}
                    <button type="button" onClick={() => { setActionMessage(null); setDeleteTarget(item); }} disabled={item.status === 'PROCESSING' || deletingId === item.id} title={item.status === 'PROCESSING' ? 'Wait for processing to finish before deleting' : 'Delete this import'} className="import-delete-button">{deletingId === item.id ? 'Deleting...' : 'Delete'}</button>
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && total > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400"><span>Page {page} of {totalPages} ({total} imports)</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg bg-slate-800 px-4 py-2 text-slate-200 disabled:opacity-40">Previous</button><button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg bg-slate-800 px-4 py-2 text-slate-200 disabled:opacity-40">Next</button></div></div>}
      </div>

      {deleteTarget && (
        <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingId) setDeleteTarget(null); }}>
          <section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="delete-import-title">
            <div className="ui-modal-header">
              <div><p className="eyebrow">Data operations</p><h2 id="delete-import-title">Delete import?</h2></div>
              <button type="button" className="ui-modal-close" aria-label="Close dialog" onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingId)}>×</button>
            </div>
            <div className="ui-modal-body">
              <p className="text-sm text-slate-300">Delete <strong>{deleteTarget.fileName}</strong> and its imported rows? This cannot be undone.</p>
              {(deleteTarget.status === 'COMMITTED' || deleteTarget.statement) && <p className="rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-300">This import has linked statement data. Deleting it also removes its linked statement and sales rows.</p>}
              {actionMessage && <p className="rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-300" role="alert">{actionMessage}</p>}
            </div>
            <div className="ui-modal-footer">
              <button type="button" className="secondary-action" onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingId)}>Cancel</button>
              <button type="button" className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-2 font-semibold text-red-200 hover:bg-red-900/50 disabled:opacity-50" onClick={deleteImport} disabled={Boolean(deletingId)}>{deletingId ? 'Deleting...' : 'Delete import'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
