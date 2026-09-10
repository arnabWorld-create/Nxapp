'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ReviewResponse, ReviewRow } from '../../../../lib/import/review-types';
import { MatchReviewModal } from '../../../../components/import/MatchReviewModal';
import { formatCommittedAt } from '../../../../lib/import/commit-display';

const VALIDATION_STATUS_COLORS: Record<string, string> = {
  VALID: 'bg-green-900/20 text-green-300',
  INVALID: 'bg-red-900/20 text-red-300',
  REVIEW_REQUIRED: 'bg-yellow-900/20 text-yellow-300',
  PENDING: 'bg-gray-900/20 text-gray-300',
};

const DUPLICATE_STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-900/20 text-blue-300',
  EXACT_DUPLICATE: 'bg-red-900/20 text-red-300',
  POSSIBLE_DUPLICATE: 'bg-orange-900/20 text-orange-300',
};

const MAPPING_STATUS_COLORS: Record<string, string> = {
  UNMATCHED: 'bg-slate-900/20 text-slate-300',
  SUGGESTED: 'bg-blue-900/20 text-blue-300',
  CONFIRMED: 'bg-green-900/20 text-green-300',
  REJECTED: 'bg-red-900/20 text-red-300',
  'AUTO MATCHED': 'bg-cyan-900/20 text-cyan-300',
  'PREVIOUSLY CONFIRMED': 'bg-emerald-900/20 text-emerald-300',
  'IGNORED / EXCLUDED': 'bg-slate-800 text-slate-400',
};

const ROW_TYPE_COLORS: Record<string, string> = {
  DATA_ROW: 'bg-slate-800 text-slate-300',
  SUMMARY_ROW: 'bg-amber-900/30 text-amber-300',
  NON_DATA_ROW: 'bg-slate-700 text-slate-300',
};

function formatReviewValue(value: string | null): string {
  if (value === null || value === '') return '—';

  const [integerPart, fractionPart] = value.split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const unsignedInteger = sign ? integerPart.slice(1) : integerPart;
  const formattedInteger = unsignedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${sign}${formattedInteger}${fractionPart === undefined ? '' : `.${fractionPart}`}`;
}

interface ReviewData {
  import: any;
  summary: any;
  pagination: any;
  rows: ReviewRow[];
}

interface CommitPreflightResult {
  importId: string;
  status: string;
  totalRows: number;
  eligibleRows: number;
  invalidRows: number;
  reviewRequiredRows: number;
  duplicateRows: number;
  unmappedRows: number;
  missingConfirmedMappingRows: number;
  alreadyCommitted: boolean;
  canCommit: boolean;
  blockers: string[];
}

interface CommitResult {
  success: boolean;
  importId: string;
  statementId: string;
  committedRows: number;
  status: string;
  committedAt: string;
}

interface DistributorOption {
  id: string;
  name: string;
  salesperson: { id: string; name: string; email: string } | null;
}

export default function ImportReviewPage() {
  const params = useParams();
  const router = useRouter();
  const importId = params.id as string;

  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canCommit, setCanCommit] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [validationStatus, setValidationStatus] = useState<string>('');
  const [duplicateStatus, setDuplicateStatus] = useState<string>('');
  const [mappingStatus, setMappingStatus] = useState<string>('');
  const [rowType, setRowType] = useState<string>('');
  const [defaultUnit, setDefaultUnit] = useState('PCS');
  const [unitApplying, setUnitApplying] = useState(false);
  const [summaryAcknowledging, setSummaryAcknowledging] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [selectedRow, setSelectedRow] = useState<ReviewRow | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);

  // Commit workflow state
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [preflightData, setPreflightData] = useState<CommitPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [periodStartDate, setPeriodStartDate] = useState('');
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [distributorId, setDistributorId] = useState('');

  const fetchReview = useCallback(async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      queryParams.set('page', page.toString());
      queryParams.set('pageSize', pageSize.toString());
      if (search) queryParams.set('search', search);
      if (validationStatus) queryParams.set('validationStatus', validationStatus);
      if (duplicateStatus) queryParams.set('duplicateStatus', duplicateStatus);
      if (mappingStatus) queryParams.set('mappingStatus', mappingStatus);
      if (rowType) queryParams.set('rowType', rowType);

      const response = await fetch(`/api/imports/${importId}/review?${queryParams.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to load review data');
        return;
      }

      const data = await response.json();
      setReviewData(data);
      if (data.import.defaultQuantityUnitConfirmed && data.import.defaultQuantityUnit) {
        setDefaultUnit(data.import.defaultQuantityUnit);
      }
      setError(null);
    } catch (err) {
      setError('Unable to load review data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [importId, page, pageSize, search, validationStatus, duplicateStatus, mappingStatus, rowType]);

  useEffect(() => {
    let cancelled = false;

    const protectRoute = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) {
          router.replace('/login');
          return;
        }
        const authData = await response.json();
        const permissions = authData.user?.permissions ?? [];
        setCanCommit(permissions.includes('commit_import'));
        if (!permissions.includes('review_import')) {
          setError('Permission denied');
          return;
        }
      } catch {
        router.replace('/login');
        return;
      }

      if (!cancelled) fetchReview();
    };

    protectRoute();

    return () => {
      cancelled = true;
    };
  }, [fetchReview, router]);

  // Commit workflow functions
  const fetchPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setCommitError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/commit-preflight`);
      if (!response.ok) {
        const errorData = await response.json();
        setCommitError(errorData.error || 'Failed to load commit preflight');
        setPreflightData(null);
        return;
      }
      const data = await response.json();
      setPreflightData(data);
    } catch (err) {
      setCommitError('Unable to load commit preflight');
      console.error(err);
    } finally {
      setPreflightLoading(false);
    }
  }, [importId]);

  const fetchDistributors = useCallback(async () => {
    try {
      const response = await fetch('/api/distributors?status=ACTIVE', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load distributors');
      setDistributors((await response.json()).distributors);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Unable to load distributors');
    }
  }, []);

  const validatePeriod = (): string | null => {
    if (!periodStartDate || !periodEndDate) {
      return 'Both start and end dates are required';
    }
    const start = new Date(periodStartDate);
    const end = new Date(periodEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 'Invalid date format';
    }
    if (end < start) {
      return 'End date must be on or after start date';
    }
    return null;
  };

  const handleOpenCommit = async () => {
    setShowCommitModal(true);
    setShowConfirmDialog(false);
    setShowSuccessDialog(false);
    setCommitResult(null);
    setCommitError(null);
    setPeriodStartDate('');
    setPeriodEndDate('');
    setDistributorId('');
    await Promise.all([fetchPreflight(), fetchDistributors()]);
  };

  const handleCloseCommit = () => {
    setShowCommitModal(false);
    setShowConfirmDialog(false);
    setShowSuccessDialog(false);
    setCommitResult(null);
    setCommitError(null);
    setPeriodStartDate('');
    setPeriodEndDate('');
    setDistributorId('');
  };

  const handleConfirmCommit = async () => {
    if (!distributorId) {
      setCommitError('Distributor is required');
      return;
    }
    const validationError = validatePeriod();
    if (validationError) {
      setCommitError(validationError);
      return;
    }

    if (!preflightData?.canCommit) {
      setCommitError('Preflight check failed - cannot commit');
      return;
    }

    setCommitLoading(true);
    setCommitError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          period_start_date: periodStartDate,
          period_end_date: periodEndDate,
          distributor_id: distributorId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          if (data.blockers) {
            setPreflightData(prev => prev ? { ...prev, blockers: data.blockers, canCommit: false } : null);
            setShowConfirmDialog(false);
          }
        }
        setCommitError(data.error || 'Commit failed');
        return;
      }

      setCommitResult(data);
      setShowConfirmDialog(false);
      setShowSuccessDialog(true);
      fetchReview(); // Refresh the review data
    } catch (err) {
      setCommitError('Unable to commit import');
      console.error(err);
    } finally {
      setCommitLoading(false);
    }
  };

  const handleViewStatement = () => {
    if (commitResult?.statementId) {
      router.push(`/statements/${commitResult.statementId}` as any);
    }
  };

  const handleApplyDefaultUnit = async () => {
    setUnitApplying(true);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/review/quantity-unit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: defaultUnit, confirmed: true }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to apply unit');
      await fetchReview();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Unable to apply unit');
    } finally { setUnitApplying(false); }
  };

  const handleAcknowledgeSummaryRows = async () => {
    setSummaryAcknowledging(true);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/review/summary-acknowledgement`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to acknowledge rows');
      await fetchReview();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Unable to acknowledge rows');
    } finally { setSummaryAcknowledging(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="text-slate-400">Loading review data...</p>
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

  if (!reviewData) {
    return null;
  }

  const { import: importInfo, summary, pagination, rows } = reviewData;

  return (
    <main className="page-frame review-page">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="page-header review-header">
          <div>
            <p className="eyebrow">Review workspace</p>
            <div>
              <h1>{importInfo.fileName}</h1>
              <p className="page-subtitle">Review rows, confirm master matches, and finalize this import.</p>
              <div className="review-meta"><span>{importInfo.status.replaceAll('_', ' ')}</span><span>Uploaded {new Date(importInfo.createdAt).toLocaleString()}</span></div>
            </div>
          </div>
          <div className="review-actions">
              <button
                onClick={() => router.back()}
                className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition"
              >
                Back
              </button>
              {importInfo.status !== 'COMMITTED' && canCommit && (
                <button
                  onClick={handleOpenCommit}
                  disabled={preflightLoading || commitLoading}
                  className="px-4 py-2 bg-green-600 text-green-50 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                >
                  {preflightLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Checking...
                    </>
                  ) : (
                    'Commit Import'
                  )}
                </button>
              )}
              {importInfo.status === 'COMMITTED' && (
                <span className="px-4 py-2 bg-green-900/30 text-green-300 rounded-lg font-medium">
                  Already Committed
                </span>
              )}
          </div>
        </div>

        {/* Summary Stats - Phase 2 Metrics */}
        <div className="mb-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-400 uppercase">Total Rows</p>
            <p className="text-2xl font-bold mt-1">{summary.totalRows}</p>
          </div>
          <div className="rounded-lg bg-green-900/20 border border-green-800 p-4">
            <p className="text-xs text-green-300 uppercase">Valid</p>
            <p className="text-2xl font-bold text-green-300 mt-1">{summary.validRows}</p>
          </div>
          <div className="rounded-lg bg-yellow-900/20 border border-yellow-800 p-4">
            <p className="text-xs text-yellow-300 uppercase">Review Required</p>
            <p className="text-2xl font-bold text-yellow-300 mt-1">{summary.reviewRequiredRows}</p>
          </div>
          <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
            <p className="text-xs text-red-300 uppercase">Invalid</p>
            <p className="text-2xl font-bold text-red-300 mt-1">{summary.invalidRows}</p>
          </div>
          <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
            <p className="text-xs text-red-300 uppercase">Exact Duplicates</p>
            <p className="text-2xl font-bold text-red-300 mt-1">{summary.exactDuplicates}</p>
          </div>
          <div className="rounded-lg bg-orange-900/20 border border-orange-800 p-4">
            <p className="text-xs text-orange-300 uppercase">Possible Duplicates</p>
            <p className="text-2xl font-bold text-orange-300 mt-1">{summary.possibleDuplicates}</p>
          </div>
        </div>

        {/* Summary Stats - Phase 3 Mapping Metrics */}
        <div className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4">
            <p className="text-xs text-slate-400 uppercase">Unmatched</p>
            <p className="text-2xl font-bold text-slate-300 mt-1">{summary.unmatchedRows}</p>
          </div>
          <div className="rounded-lg bg-blue-900/20 border border-blue-800 p-4">
            <p className="text-xs text-blue-300 uppercase">Suggested</p>
            <p className="text-2xl font-bold text-blue-300 mt-1">{summary.suggestedRows}</p>
          </div>
          <div className="rounded-lg bg-green-900/20 border border-green-800 p-4">
            <p className="text-xs text-green-300 uppercase">Confirmed</p>
            <p className="text-2xl font-bold text-green-300 mt-1">{summary.confirmedRows}</p>
          </div>
          <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
            <p className="text-xs text-red-300 uppercase">Rejected</p>
            <p className="text-2xl font-bold text-red-300 mt-1">{summary.rejectedRows}</p>
          </div>
        </div>

        {decisionError && <p className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-300">{decisionError}</p>}

        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Filters & Search</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Item name or row number..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Row Type</label>
              <select value={rowType} onChange={(e) => { setRowType(e.target.value); setPage(1); }} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"><option value="">All</option><option value="DATA_ROW">Data Rows</option><option value="SUMMARY_ROW">Summary Rows</option><option value="NON_DATA_ROW">Non-data Rows</option></select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Validation Status</label>
              <select
                value={validationStatus}
                onChange={(e) => {
                  setValidationStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="">All</option>
                <option value="VALID">Valid</option>
                <option value="REVIEW_REQUIRED">Review Required</option>
                <option value="INVALID">Invalid</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Duplicate Status</label>
              <select
                value={duplicateStatus}
                onChange={(e) => {
                  setDuplicateStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="">All</option>
                <option value="EXACT_DUPLICATE">Exact Duplicate</option>
                <option value="POSSIBLE_DUPLICATE">Possible Duplicate</option>
                <option value="NEW">New</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Mapping Status</label>
              <select
                value={mappingStatus}
                onChange={(e) => {
                  setMappingStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="">All</option>
                <option value="UNMATCHED">Unmatched</option>
                <option value="SUGGESTED">Suggested</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="REJECTED">Rejected</option>
                <option value="IGNORED">Ignored / Excluded</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Page Size</label>
              <select
                value={pageSize.toString()}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value, 10));
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">&nbsp;</label>
              <button
                onClick={() => {
                  setSearch('');
                  setValidationStatus('');
                  setDuplicateStatus('');
                  setMappingStatus('');
                  setRowType('');
                  setPage(1);
                }}
                className="w-full px-3 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="mb-8 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] w-full text-sm">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-700">
                  <th className="sticky left-0 z-10 bg-slate-800 px-4 py-3 text-left font-semibold text-slate-300">Row</th>
                  <th className="sticky left-14 z-10 bg-slate-800 px-4 py-3 text-left font-semibold text-slate-300">Source Item</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Brand</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Product</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Variant</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Purchase Qty</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Purchase Value</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Sales Qty</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Sales Value</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Closing Stock Qty</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Reported Closing Stock Value</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Unit / Resolution</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Row Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Validation</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Duplicate</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Mapping</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="px-4 py-8 text-center text-slate-400">
                      No rows found
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="sticky left-0 z-[1] bg-slate-900 px-4 py-3 text-slate-300">{row.sourceRowNumber ?? '—'}</td>
                      <td className="sticky left-14 z-[1] bg-slate-900 px-4 py-3 text-slate-300 max-w-xs truncate">{row.sourceItemName || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{row.confirmedBrand?.name || (row.suggestedBrand ? `Suggested: ${row.suggestedBrand.name}` : '—')}</td>
                      <td className="px-4 py-3 text-slate-300">{row.confirmedProduct?.name || (row.suggestedProduct ? `Suggested: ${row.suggestedProduct.name}` : '—')}</td>
                      <td className="px-4 py-3 text-slate-300">{row.confirmedVariant?.name || (row.suggestedVariant ? `Suggested: ${row.suggestedVariant.name}` : '—')}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedPurchaseQty)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedPurchaseValue)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedSalesQty)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedSalesValue)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedClosingStockQty)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{formatReviewValue(row.reportedClosingStockValue)}</td>
                      <td className="px-4 py-3 text-slate-300">
                        <div>{row.quantityUnit || '—'}</div>
                        <div className={`text-xs ${row.quantityUnitResolution === 'UNRESOLVED' ? 'text-amber-300' : 'text-slate-500'}`}>
                          {row.quantityUnitResolution === 'EXPLICIT_SOURCE' ? 'Source unit' : row.quantityUnitResolution === 'FILE_DEFAULT' ? 'File default' : 'Unresolved'}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-xs" title={row.nonDataReason || undefined}>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${ROW_TYPE_COLORS[row.rowType]}`}>{row.rowType}</span>
                        {row.nonDataReason && <div className="mt-1 text-xs text-slate-500 truncate">{row.nonDataReason}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${row.rowType === 'SUMMARY_ROW' ? 'bg-slate-800 text-slate-400' : VALIDATION_STATUS_COLORS[row.validationStatus]}`}>
                          {row.rowType === 'SUMMARY_ROW' ? 'IGNORED / EXCLUDED' : row.validationStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${row.rowType === 'SUMMARY_ROW' ? 'bg-slate-800 text-slate-400' : DUPLICATE_STATUS_COLORS[row.duplicateStatus]}`}>
                          {row.rowType === 'SUMMARY_ROW' ? 'IGNORED / EXCLUDED' : row.duplicateStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${MAPPING_STATUS_COLORS[row.mappingLabel || row.mappingStatus]}`}>
                          {row.mappingLabel || row.mappingStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 space-x-2">
                        {row.rowType === 'DATA_ROW' && row.mappingStatus !== 'CONFIRMED' && (
                          <button
                            onClick={() => {
                              setSelectedRow(row);
                              setShowMatchModal(true);
                            }}
                            className="text-blue-400 hover:text-blue-300 transition"
                          >
                            Match
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedRow(row);
                            setShowDetail(true);
                          }}
                          className="text-slate-400 hover:text-slate-300 transition"
                        >
                          Details
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
            Page {pagination.page} of {pagination.totalPages} ({pagination.totalRows} total rows)
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

        {/* Commit Modal */}
        {showCommitModal && (
          <div className="ui-modal-backdrop" role="presentation">
            <div className="ui-modal commit-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-dialog-title">
              <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
                <h2 id="commit-dialog-title" className="text-xl font-semibold">Commit Import</h2>
                <button
                  onClick={handleCloseCommit}
                  className="text-slate-400 hover:text-slate-200"
                  disabled={commitLoading}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              <div className="p-6 space-y-6">
                {commitError && (
                  <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
                    <p className="text-red-300 text-sm">{commitError}</p>
                  </div>
                )}

                {/* Preflight Results */}
                {preflightLoading ? (
                  <div className="text-center text-slate-400 py-8">
                    <svg className="animate-spin h-8 w-8 mx-auto text-blue-400" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    <p className="mt-2">Running commit preflight...</p>
                  </div>
                ) : preflightData ? (
                  <div className="space-y-4">
                    <div className={`rounded-lg p-4 ${preflightData.canCommit ? 'bg-green-900/20 border border-green-800' : 'bg-red-900/20 border border-red-800'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-lg font-semibold ${preflightData.canCommit ? 'text-green-300' : 'text-red-300'}`}>
                          {preflightData.canCommit ? '✓ Ready to Commit' : '✗ Commit Blocked'}
                        </span>
                        {preflightData.alreadyCommitted && (
                          <span className="px-2 py-1 bg-amber-900 text-amber-300 text-xs rounded">Already Committed</span>
                        )}
                      </div>
                      <p className={`text-sm ${preflightData.canCommit ? 'text-green-200' : 'text-red-200'}`}>
                        {preflightData.canCommit
                          ? `All ${preflightData.eligibleRows} eligible rows will be committed to a new Statement.`
                          : `${preflightData.blockers.length} blocker(s) must be resolved before commit.`}
                      </p>
                    </div>

                    {preflightData.blockers.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-300 mb-2">Blockers:</h4>
                        <ul className="space-y-1">
                          {preflightData.blockers.map((blocker, idx) => (
                            <li key={idx} className="text-sm text-red-300 flex items-center gap-2">
                              <span>•</span> {blocker}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Total Rows</p>
                        <p className="font-semibold">{preflightData.totalRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Eligible Rows</p>
                        <p className="font-semibold text-green-300">{preflightData.eligibleRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Invalid Rows</p>
                        <p className="font-semibold text-red-300">{preflightData.invalidRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Review Required</p>
                        <p className="font-semibold text-yellow-300">{preflightData.reviewRequiredRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Duplicates</p>
                        <p className="font-semibold text-orange-300">{preflightData.duplicateRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Unmapped</p>
                        <p className="font-semibold text-slate-300">{preflightData.unmappedRows}</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="text-slate-400">Missing Confirmed</p>
                        <p className="font-semibold text-amber-300">{preflightData.missingConfirmedMappingRows}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-slate-400 py-8">
                    <p>No preflight data available</p>
                  </div>
                )}

                {/* Distributor and period inputs - only show if canCommit */}
                {preflightData?.canCommit && !showConfirmDialog && !showSuccessDialog && (
                  <div className="space-y-4 pt-4 border-t border-slate-800">
                    <div>
                      <label className="block text-sm text-slate-300 mb-2">Distributor *</label>
                      <select value={distributorId} onChange={(e) => setDistributorId(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100" required>
                        <option value="">Select Distributor</option>
                        {distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}{distributor.salesperson ? ` - ${distributor.salesperson.name}` : ''}</option>)}
                      </select>
                    </div>
                    <h4 className="text-lg font-semibold">Statement Period</h4>
                    <p className="text-sm text-slate-400">
                      Enter the reporting period for the new Statement. This period will be stored
                      with the committed data and cannot be changed after commit.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-slate-300 mb-2">Period Start Date</label>
                        <input
                          type="date"
                          value={periodStartDate}
                          onChange={(e) => setPeriodStartDate(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-300 mb-2">Period End Date</label>
                        <input
                          type="date"
                          value={periodEndDate}
                          onChange={(e) => setPeriodEndDate(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
                          required
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setShowConfirmDialog(true)}
                      disabled={commitLoading}
                      className="w-full px-4 py-2 bg-green-600 text-green-50 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {commitLoading ? 'Checking...' : 'Review & Confirm'}
                    </button>
                  </div>
                )}

                {/* Confirmation Dialog */}
                {showConfirmDialog && !showSuccessDialog && (
                  <div className="space-y-4 pt-4 border-t border-slate-800 bg-amber-900/10 border-amber-800 rounded-lg p-4">
                    <h4 className="text-lg font-semibold text-amber-300">Confirm Commit</h4>
                    <p className="text-sm text-slate-300">
                      This will create a finalized Statement with status <strong className="text-green-300">APPROVED</strong>
                      containing {preflightData?.eligibleRows} rows from this import.
                    </p>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <p className="text-sm"><span className="text-slate-400">Period:</span> {periodStartDate} to {periodEndDate}</p>
                      <p className="text-sm"><span className="text-slate-400">Rows:</span> {preflightData?.eligibleRows}</p>
                      <p className="text-sm"><span className="text-slate-400">Status:</span> <span className="text-green-300">APPROVED</span></p>
                      <p className="text-sm"><span className="text-slate-400">Source File:</span> {importInfo.fileName}</p>
                    </div>
                    <p className="text-xs text-slate-400">
                      The import will be marked as <strong>COMMITTED</strong> and cannot be committed again.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowConfirmDialog(false)}
                        disabled={commitLoading}
                        className="flex-1 px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmCommit}
                        disabled={commitLoading}
                        className="flex-1 px-4 py-2 bg-green-600 text-green-50 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {commitLoading ? 'Committing...' : 'Confirm Commit'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Success Dialog */}
                {showSuccessDialog && commitResult && (
                  <div className="space-y-4 pt-4 border-t border-slate-800 bg-green-900/10 border-green-800 rounded-lg p-4">
                    <div className="flex items-center gap-3 text-green-300">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                      <h4 className="text-lg font-semibold">Import Committed Successfully</h4>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <p className="text-sm"><span className="text-slate-400">Statement ID:</span> <code className="text-slate-200 font-mono">{commitResult.statementId}</code></p>
                      <p className="text-sm"><span className="text-slate-400">Committed Rows:</span> {commitResult.committedRows}</p>
                      <p className="text-sm"><span className="text-slate-400">Period:</span> {periodStartDate} to {periodEndDate}</p>
                        <p className="text-sm"><span className="text-slate-400">Statement Status:</span> <span className="text-green-300">APPROVED</span></p>
                      <p className="text-sm"><span className="text-slate-400">Import Status:</span> <span className="text-green-300">COMMITTED</span></p>
                      <p className="text-sm"><span className="text-slate-400">Committed At:</span> {formatCommittedAt(commitResult.committedAt)}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleViewStatement}
                        className="flex-1 px-4 py-2 bg-blue-600 text-blue-50 rounded-lg hover:bg-blue-700 transition"
                      >
                        View Statement
                      </button>
                      <button
                        onClick={handleCloseCommit}
                        className="flex-1 px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Match Review Modal */}
        {showMatchModal && selectedRow && (
          <MatchReviewModal
            row={selectedRow}
            importId={importId}
            onClose={() => setShowMatchModal(false)}
            onSuccess={() => {
              setShowMatchModal(false);
              fetchReview();
            }}
          />
        )}

        {/* Detail Modal */}
        {showDetail && selectedRow && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-semibold">Row {selectedRow.sourceRowNumber} Details</h2>
                <button
                  onClick={() => setShowDetail(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <p className="text-slate-400">Row Type</p>
                    <p className="mt-1 font-medium">{selectedRow.rowType}</p>
                    {selectedRow.nonDataReason && <p className="mt-1 text-xs text-amber-300">{selectedRow.nonDataReason}</p>}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <p className="text-slate-400">Unit Resolution</p>
                    <p className="mt-1 font-medium">{selectedRow.quantityUnit || 'Unresolved'}</p>
                    <p className="mt-1 text-xs text-slate-500">{selectedRow.quantityUnitResolution === 'EXPLICIT_SOURCE' ? `Source: ${selectedRow.sourceQuantityUnit}` : selectedRow.quantityUnitResolution === 'FILE_DEFAULT' ? 'Applied from confirmed file default' : 'Requires review'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <p className="text-slate-400">Mapping</p>
                    <p className="mt-1 font-medium">{selectedRow.mappingStatus}</p>
                    <p className="mt-1 text-xs text-slate-500">{selectedRow.confirmedMatch ? selectedRow.confirmedMatch.entityName : selectedRow.suggestedProduct?.name || selectedRow.suggestedBrand?.name || selectedRow.suggestedVariant?.name || 'No master selected'}</p>
                  </div>
                </div>
                {/* Source Data */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Source Data</h3>
                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {Object.entries(selectedRow.rawData).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-slate-400">{key}:</span>{' '}
                          <span className="text-slate-200 font-mono">{value === null || value === undefined || value === '' ? '—' : String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Normalized Data */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Normalized Data</h3>
                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedRow.normalizedData &&
                        Object.entries(selectedRow.normalizedData).map(([key, value]) => (
                          <div key={key} className="text-sm">
                            <span className="text-slate-400">{key}:</span>{' '}
                            <span className="text-slate-200 font-mono">{value === null || value === undefined || value === '' ? '—' : String(value)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                {/* Validation Issues */}
                {selectedRow.validationIssues && selectedRow.validationIssues.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Validation Issues</h3>
                    <div className="space-y-2">
                      {selectedRow.validationIssues.map((issue: any, idx: number) => (
                        <div key={idx} className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-yellow-300">{issue.code}</p>
                              <p className="text-sm text-yellow-200 mt-1">{issue.message}</p>
                              <p className="text-xs text-yellow-300 mt-1">Field: {issue.field}</p>
                            </div>
                            <span className="text-xs bg-yellow-900 px-2 py-1 rounded">{issue.severity}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duplicate Analysis */}
                {selectedRow.duplicateResult && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Duplicate Analysis</h3>
                    <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 space-y-3">
                      <div>
                        <p className="text-slate-400">Status:</p>
                        <p className="text-slate-200 font-medium">{selectedRow.duplicateResult.status}</p>
                      </div>
                      {selectedRow.duplicateResult.score !== undefined && (
                        <div>
                          <p className="text-slate-400">Similarity Score:</p>
                          <p className="text-slate-200 font-medium">{selectedRow.duplicateResult.score}%</p>
                        </div>
                      )}
                      {selectedRow.duplicateResult.matchedFields && (
                        <div>
                          <p className="text-slate-400">Matched Fields:</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {selectedRow.duplicateResult.matchedFields.map((field: string) => (
                              <span key={field} className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded">
                                {field}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedRow.duplicateResult.differences && (
                        <div>
                          <p className="text-slate-400">Differences:</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {selectedRow.duplicateResult.differences.map((field: string) => (
                              <span key={field} className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded">
                                {field}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mapping Info */}
                {selectedRow.confirmedMatch && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Confirmed Match</h3>
                    <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
                      <div className="space-y-2">
                        <p className="text-sm">
                          <span className="text-slate-400">Entity Type:</span>{' '}
                          <span className="text-green-300 font-medium">{selectedRow.confirmedMatch.entityType}</span>
                        </p>
                        <p className="text-sm">
                          <span className="text-slate-400">Entity Name:</span>{' '}
                          <span className="text-green-300 font-medium">{selectedRow.confirmedMatch.entityName}</span>
                        </p>
                        {selectedRow.confirmedMatch.confirmedBy && (
                          <p className="text-sm">
                            <span className="text-slate-400">Confirmed By:</span> {selectedRow.confirmedMatch.confirmedBy}
                          </p>
                        )}
                        {selectedRow.confirmedMatch.reason && (
                          <p className="text-sm">
                            <span className="text-slate-400">Reason:</span> {selectedRow.confirmedMatch.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
