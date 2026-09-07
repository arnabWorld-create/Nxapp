'use client';

import { useEffect, useState } from 'react';
import type { ReviewRow } from '../../lib/import/review-types';
import type { MatchResult } from '../../lib/matching/types';
import { normalizeSourceItemName } from '../../lib/matching/utils';

const MAPPING_STATUS_COLORS: Record<string, string> = {
  UNMATCHED: 'bg-slate-900/20 text-slate-300',
  SUGGESTED: 'bg-blue-900/20 text-blue-300',
  CONFIRMED: 'bg-green-900/20 text-green-300',
  REJECTED: 'bg-red-900/20 text-red-300',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  EXACT: 'bg-green-900 text-green-100',
  HIGH: 'bg-blue-900 text-blue-100',
  MEDIUM: 'bg-yellow-900 text-yellow-100',
  LOW: 'bg-orange-900 text-orange-100',
  NO_MATCH: 'bg-red-900 text-red-100',
};

interface MatchReviewModalProps {
  row: ReviewRow;
  importId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function MatchReviewModal({ row, importId, onClose, onSuccess }: MatchReviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [fetchingMatches, setFetchingMatches] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'suggest' | 'action' | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [creationName, setCreationName] = useState(row.sourceItemName || row.normalizedSourceItemName || '');
  const [creationBrandId, setCreationBrandId] = useState('');
  const [creationDivisionId, setCreationDivisionId] = useState('');
  const [creationProductId, setCreationProductId] = useState('');
  const [creationOpen, setCreationOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [parentOptions, setParentOptions] = useState<any[]>([]);
  const [divisionOptions, setDivisionOptions] = useState<any[]>([]);

  const parentCandidates = (type: 'BRAND' | 'PRODUCT') =>
    matchResult?.candidates.filter((candidate) => candidate.entityType === type) ?? [];

  useEffect(() => {
    if (!creationOpen) return;
    const endpoint = '/api/brands';
    const query = parentSearch.trim() || row.normalizedSourceItemName || row.sourceItemName || '';
    fetch(`${endpoint}?q=${encodeURIComponent(query)}&limit=20`)
      .then(async (response) => response.ok ? (await response.json()) : null)
      .then((data) => setParentOptions(data?.brands || []))
      .catch(() => setParentOptions([]));
  }, [creationOpen, parentSearch, row.normalizedSourceItemName, row.sourceItemName]);

  useEffect(() => {
    if (!creationOpen) return;
    fetch('/api/divisions?limit=100')
      .then(async (response) => response.ok ? (await response.json()) : null)
      .then((data) => setDivisionOptions(data?.divisions || []))
      .catch(() => setDivisionOptions([]));
  }, [creationOpen]);

  const fetchSuggestedMatches = async () => {
    if (matchResult) return; // Already fetched
    setFetchingMatches(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/matches/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          importRowId: row.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to fetch suggestions');
        return;
      }

      const data = await response.json();
      setMatchResult(data);
      setSelectedAction('action');
    } catch (err) {
      setError('Unable to fetch match suggestions');
      console.error(err);
    } finally {
      setFetchingMatches(false);
    }
  };

  const handleConfirm = async (candidate: any) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/matches/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          importRowId: row.id,
          selectedCandidateId: `${candidate.entityType}:${candidate.entityId}`,
          action: 'confirm',
          reason: reason || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to confirm match');
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError('Unable to confirm match');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!creationName.trim()) {
      setError('Product name is required');
      return;
    }
    if (!creationDivisionId) {
      setError('Division is required for a Product');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/matches/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importRowId: row.id,
          entityType: 'PRODUCT',
          name: creationName,
          brandId: creationBrandId || undefined,
          divisionId: creationDivisionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.existingId ? `${data.error}. Use Suggest Match to select the existing record.` : data.error || 'Failed to create master');
        return;
      }
      setCreationOpen(false);
      onSuccess();
      onClose();
    } catch {
      setError('Unable to create master');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/matches/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          importRowId: row.id,
          action: 'reject',
          reason: reason || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to reject match');
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError('Unable to reject match');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveUnmatched = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${importId}/matches/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          importRowId: row.id,
          action: 'leave-unmatched',
          reason: reason || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to update match status');
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError('Unable to update match status');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-3xl max-h-[90vh] overflow-y-auto w-full">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Match Review</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Source Item */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Source Item</h3>
            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
              <p className="text-slate-200 font-mono">{row.sourceItemName || '(empty)'}</p>
              {(row.normalizedSourceItemName || row.sourceItemName) && (
                <p className="text-slate-400 text-sm mt-2">
                  Normalized: <span className="font-mono">{normalizeSourceItemName(row.sourceItemName || row.normalizedSourceItemName || '')}</span>
                </p>
              )}
            </div>
          </div>

          {/* Current Status */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Current Status</h3>
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded text-sm font-medium ${MAPPING_STATUS_COLORS[row.mappingStatus]}`}>
                {row.mappingStatus}
              </span>
              {row.confirmedMatch && (
                <div className="text-sm text-slate-300">
                  Confirmed: <span className="font-medium">{row.confirmedMatch.entityType}</span> - {row.confirmedMatch.entityName}
                </div>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Suggested Matches */}
          {selectedAction === 'action' && matchResult && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Suggested Matches</h3>
              {matchResult.candidates && matchResult.candidates.length > 0 ? (
                <div className="space-y-2">
                  {matchResult.candidates.map((candidate: any, idx: number) => (
                    <div
                      key={idx}
                      className={`border rounded-lg p-4 cursor-pointer transition ${
                        selectedCandidate === candidate
                          ? 'border-blue-500 bg-blue-900/10'
                          : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                      }`}
                      onClick={() => setSelectedCandidate(candidate)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <p className="font-medium text-slate-200">{candidate.entityName}</p>
                            <span className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">
                              {candidate.entityType}
                            </span>
                          </div>
                          <p className="text-sm text-slate-400">{candidate.explanation || ''}</p>
                          {candidate.matchedTokens && candidate.matchedTokens.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.matchedTokens.map((token: string) => (
                                <span
                                  key={token}
                                  className="text-xs bg-green-900/50 text-green-300 px-2 py-1 rounded"
                                >
                                  {token}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-bold px-3 py-1 rounded ${CONFIDENCE_COLORS[candidate.confidence]}`}>
                            {candidate.score}%
                          </p>
                          <p className="text-xs text-slate-400 mt-1">{candidate.confidence}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm">No suggestions available for this item.</div>
              )}
            </div>
          )}

          {creationOpen && (
            <div className="rounded-lg border border-blue-800 bg-blue-900/10 p-4 space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Create New Master</h3>
                <p className="text-sm text-slate-400 mt-1">Source value: <span className="font-mono text-slate-200">{row.sourceItemName || '—'}</span>. The created Product will be learned for this source item.</p>
              </div>
              <label className="block text-sm text-slate-300">Master Medicine Item / Product name
                <input value={creationName} onChange={(event) => setCreationName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100" />
              </label>
              <label className="block text-sm text-slate-300">Legacy Brand (optional)
                <input value={parentSearch} onChange={(event) => setParentSearch(event.target.value)} placeholder="Search existing brands" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100" />
                <select value={creationBrandId} onChange={(event) => setCreationBrandId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100">
                  <option value="">No Brand (direct medicine item)</option>{[...parentCandidates('BRAND').map((candidate) => ({ id: candidate.entityId, name: candidate.entityName })), ...parentOptions].filter((option, index, options) => options.findIndex((item) => item.id === option.id) === index).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label className="block text-sm text-slate-300">Division (required)
                <select value={creationDivisionId} onChange={(event) => setCreationDivisionId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100">
                  <option value="">Select a Division</option>{divisionOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <div className="flex gap-3"><button onClick={() => setCreationOpen(false)} disabled={loading} className="flex-1 px-4 py-2 bg-slate-700 text-slate-200 rounded-lg">Cancel</button><button onClick={handleCreate} disabled={loading || !creationName.trim() || !creationDivisionId} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{loading ? 'Creating...' : 'Create Master'}</button></div>
            </div>
          )}

          {/* Reason Input */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you confirming/rejecting this match?"
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500 disabled:opacity-50"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            {selectedAction === null && (
              <>
                <button
                  onClick={fetchSuggestedMatches}
                  disabled={loading || fetchingMatches}
                  className="flex-1 px-4 py-2 bg-blue-600 text-blue-50 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {fetchingMatches ? 'Loading...' : 'Suggest Match'}
                </button>
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-red-900/30 text-red-300 rounded-lg hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Reject
                </button>
                <button
                  onClick={handleLeaveUnmatched}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Leave Unmatched
                </button>
                <button onClick={() => { setError(null); setCreationOpen(true); }} disabled={loading} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50">Create Master</button>
              </>
            )}
            {selectedAction === 'action' && selectedCandidate && (
              <>
                <button
                  onClick={() => handleConfirm(selectedCandidate)}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-green-600 text-green-50 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {loading ? 'Confirming...' : 'Accept'}
                </button>
                <button
                  onClick={() => setSelectedAction(null)}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
