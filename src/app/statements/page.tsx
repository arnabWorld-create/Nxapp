'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const STATUS_COLORS: Record<string, string> = {
  UPLOADED: 'bg-blue-900/20 text-blue-300',
  PROCESSING: 'bg-yellow-900/20 text-yellow-300',
  READY_FOR_REVIEW: 'bg-purple-900/20 text-purple-300',
  APPROVED: 'bg-green-900/20 text-green-300',
  PARTIALLY_IMPORTED: 'bg-orange-900/20 text-orange-300',
  FAILED: 'bg-red-900/20 text-red-300',
  CANCELLED: 'bg-slate-900/20 text-slate-300',
};

interface Statement {
  id: string;
  name: string | null;
  period_start_date: string;
  period_end_date: string;
  source_file_name: string;
  status: string;
  uploaded_by: string | null;
  uploaded_by_user: { id: string; name: string; email: string } | null;
  distributor: { id: string; name: string; salesperson: { id: string; name: string; email: string } | null } | null;
  created_at: string;
  row_count: number;
}

interface StatementsResponse {
  statements: Statement[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
}

export default function StatementsPage() {
  const router = useRouter();

  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [productId, setProductId] = useState('');

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalPages: 0,
    totalCount: 0,
  });

  const fetchStatements = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      queryParams.set('page', page.toString());
      queryParams.set('pageSize', pageSize.toString());
      if (search) queryParams.set('search', search);
      if (status) queryParams.set('status', status);
      if (startDate) queryParams.set('start_date', startDate);
      if (endDate) queryParams.set('end_date', endDate);
      if (divisionId) queryParams.set('division_id', divisionId);
      if (productId) queryParams.set('product_id', productId);

      const response = await fetch(`/api/statements?${queryParams.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to load statements');
        return;
      }

      const data: StatementsResponse = await response.json();
      setStatements(data.statements);
      setPagination(data.pagination);
      setError(null);
    } catch (err) {
      setError('Unable to load statements');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status, startDate, endDate, divisionId, productId]);

  useEffect(() => {
    let cancelled = false;

    const protectRoute = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) {
          router.replace('/login');
          return;
        }
      } catch {
        router.replace('/login');
        return;
      }

      if (!cancelled) fetchStatements();
    };

    protectRoute();

    return () => {
      cancelled = true;
    };
  }, [fetchStatements, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="text-slate-400">Loading statements...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-red-900/20 border border-red-900 p-4">
            <p className="text-red-300">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="page-frame operational-page">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="page-header">
            <div>
              <div><p className="eyebrow">Sales records</p><h1>Statements</h1><p className="page-subtitle">View and manage committed sales statements.</p></div>
            </div>
            <button onClick={() => router.push('/reports' as any)} className="primary-action">
              View reporting
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="filter-surface operational-filter statements-filter">
          <div className="statement-filter-heading"><div><h2>Find a statement</h2><p>Refine the committed sales records in view.</p></div><button onClick={() => { setSearch(''); setStatus(''); setStartDate(''); setEndDate(''); setDivisionId(''); setProductId(''); setPage(1); }} className="secondary-action">Clear Filters</button></div>
          <div className="statements-filter-grid">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="File name or statement name..."
                className="filter-control"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                className="filter-control"
              >
                <option value="">All</option>
                <option value="UPLOADED">UPLOADED</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="READY_FOR_REVIEW">READY_FOR_REVIEW</option>
                <option value="APPROVED">APPROVED</option>
                <option value="PARTIALLY_IMPORTED">PARTIALLY_IMPORTED</option>
                <option value="FAILED">FAILED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Period Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="filter-control"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Period End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="filter-control"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Division</label>
              <input
                type="text"
                value={divisionId}
                onChange={(e) => { setDivisionId(e.target.value); setPage(1); }}
                placeholder="Filter by division ID"
                className="filter-control"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Product</label>
              <input
                type="text"
                value={productId}
                onChange={(e) => { setProductId(e.target.value); setPage(1); }}
                placeholder="Filter by product ID"
                className="filter-control"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Page Size</label>
              <select
                value={pageSize.toString()}
                onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
                className="filter-control max-w-xs"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="surface operational-table statements-table-surface">
          <div className="overflow-x-auto">
            <table className="data-table statements-table">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-700">
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">File / Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Period</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Distributor</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Rows</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Uploaded By</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Created</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {statements.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="statement-empty"><span className="statement-empty-mark">/</span><strong>No statements found</strong><span>Try adjusting your filters or upload a new sales statement.</span></div>
                    </td>
                  </tr>
                ) : (
                  statements.map((stmt) => (
                    <tr key={stmt.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="px-4 py-3 statement-primary-cell">
                        <div>
                          <p className="text-slate-100 font-medium">{stmt.source_file_name}</p>
                          {stmt.name && (
                            <p className="text-slate-500 text-sm">{stmt.name}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 statement-secondary-cell">
                        {stmt.period_start_date} to {stmt.period_end_date}
                      </td>
                      <td className="px-4 py-3 statement-secondary-cell">
                        {stmt.distributor?.name || '—'}
                        {stmt.distributor?.salesperson && <p className="statement-meta">{stmt.distributor.salesperson.name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[stmt.status] || 'bg-slate-900/20 text-slate-300'}`}>
                          {stmt.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 statement-count">{stmt.row_count}</td>
                      <td className="px-4 py-3 statement-secondary-cell">
                        <strong>{stmt.uploaded_by_user?.name || stmt.uploaded_by || '—'}</strong><span className="statement-meta">{stmt.uploaded_by_user?.email || 'Uploaded source'}</span>
                      </td>
                      <td className="px-4 py-3 statement-secondary-cell">
                        {new Date(stmt.created_at).toLocaleDateString()}<span className="statement-meta">{new Date(stmt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => router.push(`/statements/${stmt.id}`)}
                          className="statement-view-action"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center">
          <p className="text-slate-400">
            Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total statements)
          </p>
          <div className="space-x-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
              disabled={page === pagination.totalPages}
              className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}