'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

const STATUS_COLORS: Record<string, string> = {
  UPLOADED: 'bg-blue-900/20 text-blue-300',
  PROCESSING: 'bg-yellow-900/20 text-yellow-300',
  READY_FOR_REVIEW: 'bg-purple-900/20 text-purple-300',
  APPROVED: 'bg-green-900/20 text-green-300',
  PARTIALLY_IMPORTED: 'bg-orange-900/20 text-orange-300',
  FAILED: 'bg-red-900/20 text-red-300',
  CANCELLED: 'bg-slate-900/20 text-slate-300',
};

const MAPPING_STATUS_COLORS: Record<string, string> = {
  UNMAPPED: 'bg-slate-900/20 text-slate-300',
  SUGGESTED: 'bg-blue-900/20 text-blue-300',
  CONFIRMED: 'bg-green-900/20 text-green-300',
  REJECTED: 'bg-red-900/20 text-red-300',
};

const VALIDATION_STATUS_COLORS: Record<string, string> = {
  VALID: 'bg-green-900/20 text-green-300',
  INVALID: 'bg-red-900/20 text-red-300',
  REVIEW_REQUIRED: 'bg-yellow-900/20 text-yellow-300',
  PENDING: 'bg-gray-900/20 text-gray-300',
};

interface Statement {
  id: string;
  name: string | null;
  period_start_date: string;
  period_end_date: string;
  source_file_name: string;
  source_file_path: string | null;
  status: string;
  uploaded_by: string | null;
  uploaded_by_user: { id: string; name: string; email: string } | null;
  distributor: { id: string; name: string; salesperson: { id: string; name: string; email: string } | null } | null;
  approved_by: { id: string; name: string; email: string } | null;
  approved_at: string | null;
  approval_note: string | null;
  created_at: string;
  updated_at: string;
  row_count: number;
  aggregates: {
    reported_purchase_qty: string;
    reported_purchase_value: string;
    reported_sales_qty: string;
    reported_sales_value: string;
    reported_sales_return_qty: string;
    reported_sales_return_value: string;
    reported_purchase_return_qty: string;
    reported_purchase_return_value: string;
    reported_closing_stock_qty: string;
    reported_closing_stock_value: string;
    total_rows: number;
  };
}

interface StatementRow {
  id: string;
  source_row_number: number | null;
  source_item_name: string | null;
  normalized_source_item_name: string | null;
  brand: { id: string; name: string } | null;
  product: { id: string; name: string; brand_id: string } | null;
  variant: { id: string; variant_name: string; product_id: string } | null;
  reported_purchase_qty: string | null;
  reported_purchase_value: string | null;
  reported_sales_qty: string | null;
  reported_sales_value: string | null;
  reported_sales_return_qty: string | null;
  reported_sales_return_value: string | null;
  reported_purchase_return_qty: string | null;
  reported_purchase_return_value: string | null;
  reported_closing_stock_qty: string | null;
  reported_closing_stock_value: string | null;
  quantity_unit: string | null;
  mapping_status: string;
  validation_status: string;
  duplicate_status: string;
}

interface StatementDetailResponse {
  statement: Statement;
}

interface StatementRowsResponse {
  rows: StatementRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
}

export default function StatementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const statementId = params.id as string;

  const [statement, setStatement] = useState<Statement | null>(null);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [mappingStatus, setMappingStatus] = useState('');
  const [validationStatus, setValidationStatus] = useState('');

  const [rowsPagination, setRowsPagination] = useState({
    page: 1,
    pageSize: 50,
    totalPages: 0,
    totalCount: 0,
  });

  const fetchStatement = useCallback(async () => {
    try {
      const response = await fetch(`/api/statements/${statementId}`);

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to load statement');
        return;
      }

      const data: StatementDetailResponse = await response.json();
      setStatement(data.statement);
      setError(null);
    } catch (err) {
      setError('Unable to load statement');
      console.error(err);
    }
  }, [statementId]);

  const fetchRows = useCallback(async () => {
    try {
      setRowsLoading(true);
      const queryParams = new URLSearchParams();
      queryParams.set('page', page.toString());
      queryParams.set('pageSize', pageSize.toString());
      if (search) queryParams.set('search', search);
      if (divisionId) queryParams.set('division_id', divisionId);
      if (productId) queryParams.set('product_id', productId);
      if (variantId) queryParams.set('variant_id', variantId);
      if (mappingStatus) queryParams.set('mapping_status', mappingStatus);
      if (validationStatus) queryParams.set('validation_status', validationStatus);

      const response = await fetch(`/api/statements/${statementId}/rows?${queryParams.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to load statement rows');
        return;
      }

      const data: StatementRowsResponse = await response.json();
      setRows(data.rows);
      setRowsPagination(data.pagination);
    } catch (err) {
      setError('Unable to load statement rows');
      console.error(err);
    } finally {
      setRowsLoading(false);
      setLoading(false);
    }
  }, [statementId, page, pageSize, search, divisionId, productId, variantId, mappingStatus, validationStatus]);

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

      if (!cancelled) {
        fetchStatement();
        fetchRows();
      }
    };

    protectRoute();

    return () => {
      cancelled = true;
    };
  }, [fetchRows, fetchStatement, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="text-slate-400">Loading statement...</p>
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
            <button
              onClick={() => router.back()}
              className="mt-4 px-4 py-2 bg-red-900 text-red-100 rounded-lg hover:bg-red-800"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!statement) {
    return null;
  }

  return (
    <main className="page-frame statement-detail-page">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="statement-detail-header flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold">{statement.source_file_name}</h1>
              {statement.name && <p className="mt-1 text-slate-400">{statement.name}</p>}
              <p className="mt-2 text-slate-400">Statement ID: {statement.id}</p>
              <p className="mt-2 text-slate-300">Distributor: {statement.distributor?.name || 'Legacy statement without distributor'}</p>
              {statement.distributor?.salesperson && <p className="text-slate-400">Salesperson: {statement.distributor.salesperson.name}</p>}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition"
              >
                Back to Statements
              </button>
              <span className={`px-3 py-1 rounded-lg font-medium ${STATUS_COLORS[statement.status] || 'bg-slate-900/20 text-slate-300'}`}>
                {statement.status}
              </span>
            </div>
          </div>
        </div>

        {/* Statement Info */}
        <div className="mb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Period</p>
            <p className="text-lg font-bold mt-1">{statement.period_start_date} to {statement.period_end_date}</p>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Approved By</p>
            <p className="text-lg font-bold mt-1">{statement.approved_by?.name || '—'}</p>
            {statement.approved_at && <p className="mt-1 text-xs text-slate-400">{new Date(statement.approved_at).toLocaleString()}</p>}
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Total Rows</p>
            <p className="text-lg font-bold mt-1">{statement.row_count}</p>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Uploaded By</p>
            <p className="text-lg font-bold mt-1">{statement.uploaded_by_user?.name || statement.uploaded_by || '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Created</p>
            <p className="text-lg font-bold mt-1">{new Date(statement.created_at).toLocaleString()}</p>
          </div>
        </div>

        {/* Aggregates */}
        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Aggregate Totals</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs text-slate-400">Purchase Qty</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_purchase_qty).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs text-slate-400">Purchase Value</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_purchase_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs text-slate-400">Sales Qty</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_sales_qty).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs text-slate-400">Sales Value</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_sales_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs text-slate-400">Closing Stock Qty</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_closing_stock_qty).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Returns */}
        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Returns & Adjustments</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg bg-red-900/10 border border-red-800 p-4">
              <p className="text-xs text-red-300">Sales Return Qty</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_sales_return_qty).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-red-900/10 border border-red-800 p-4">
              <p className="text-xs text-red-300">Sales Return Value</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_sales_return_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg bg-orange-900/10 border border-orange-800 p-4">
              <p className="text-xs text-orange-300">Purchase Return Qty</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_purchase_return_qty).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-orange-900/10 border border-orange-800 p-4">
              <p className="text-xs text-orange-300">Purchase Return Value</p>
              <p className="text-lg font-semibold mt-1">{parseFloat(statement.aggregates.reported_purchase_return_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Filters & Search</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Item name..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Division</label>
              <input
                type="text"
                value={divisionId}
                onChange={(e) => { setDivisionId(e.target.value); setPage(1); }}
                placeholder="Filter by division ID"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Product</label>
              <input
                type="text"
                value={productId}
                onChange={(e) => { setProductId(e.target.value); setPage(1); }}
                placeholder="Filter by product ID"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Mapping Status</label>
              <select
                value={mappingStatus}
                onChange={(e) => { setMappingStatus(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="">All</option>
                <option value="UNMAPPED">UNMAPPED</option>
                <option value="SUGGESTED">SUGGESTED</option>
                <option value="CONFIRMED">CONFIRMED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Validation Status</label>
              <select
                value={validationStatus}
                onChange={(e) => { setValidationStatus(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="">All</option>
                <option value="VALID">VALID</option>
                <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
                <option value="INVALID">INVALID</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Page Size</label>
              <select
                value={pageSize.toString()}
                onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="lg:col-span-6">
              <button
                onClick={() => { setSearch(''); setDivisionId(''); setProductId(''); setVariantId(''); setMappingStatus(''); setValidationStatus(''); setPage(1); }}
                className="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-700">
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Row</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Source Item</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Brand</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Product</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Variant</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Purch Qty</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Purch Value</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Sales Qty</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Sales Value</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Sales Ret Qty</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Purch Ret Qty</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Close Stock Qty</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Unit</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Mapping</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-8 text-center text-slate-400">
                      No rows found
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="px-4 py-3 text-slate-300">{row.source_row_number}</td>
                      <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{row.source_item_name || row.normalized_source_item_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.brand?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.product?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.variant?.variant_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_purchase_qty ? parseFloat(row.reported_purchase_qty).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_purchase_value ? parseFloat(row.reported_purchase_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_sales_qty ? parseFloat(row.reported_sales_qty).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_sales_value ? parseFloat(row.reported_sales_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_sales_return_qty ? parseFloat(row.reported_sales_return_qty).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_purchase_return_qty ? parseFloat(row.reported_purchase_return_qty).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.reported_closing_stock_qty ? parseFloat(row.reported_closing_stock_qty).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.quantity_unit || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${MAPPING_STATUS_COLORS[row.mapping_status] || 'bg-slate-900/20 text-slate-300'}`}>
                          {row.mapping_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${VALIDATION_STATUS_COLORS[row.validation_status] || 'bg-gray-900/20 text-gray-300'}`}>
                          {row.validation_status}
                        </span>
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
            Page {rowsPagination.page} of {rowsPagination.totalPages} ({rowsPagination.totalCount} total rows)
          </p>
          <div className="space-x-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1 || rowsLoading}
              className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(rowsPagination.totalPages, page + 1))}
              disabled={page === rowsPagination.totalPages || rowsLoading}
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