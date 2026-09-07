'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HeaderMappingResult } from '../../lib/import/mapping';
import { canonicalFields, canonicalFieldLabels, REQUIRED_CANONICAL_FIELDS } from '../../lib/import/mapping';

type MappingEditorProps = {
  initialResults: HeaderMappingResult[];
  onChange?: (results: HeaderMappingResult[]) => void;
};

const fieldOptions = [{ value: '', label: 'Select target field' }].concat(
  canonicalFields.map((field) => ({ value: field, label: canonicalFieldLabels[field] }))
);

export default function MappingEditor({ initialResults, onChange }: MappingEditorProps) {
  const [results, setResults] = useState<HeaderMappingResult[]>(initialResults);

  useEffect(() => {
    setResults(initialResults);
  }, [initialResults]);

  useEffect(() => {
    onChange?.(results);
  }, [results, onChange]);

  const requiredCheckSummary = useMemo(() => {
    const missingRequired = REQUIRED_CANONICAL_FIELDS.filter(
      (requiredField) => !results.some((result) => result.targetField === requiredField)
    );
    return {
      missingRequired,
      allRequiredMapped: missingRequired.length === 0,
    };
  }, [results]);

  const updateResult = (index: number, update: Partial<HeaderMappingResult>) => {
    setResults((current) => {
      const next = [...current];
      next[index] = {
        ...next[index],
        ...update,
      };
      return next;
    });
  };

  const handleTargetFieldChange = (index: number, field: string) => {
    const targetField = field === '' ? null : (field as HeaderMappingResult['targetField']);
    updateResult(index, {
      targetField,
      confidence: targetField ? 'HIGH' : 'NONE',
      status: targetField ? 'AUTO_MAPPED' : 'UNMAPPED',
    });
  };

  const handleClear = (index: number) => {
    updateResult(index, {
      targetField: null,
      confidence: 'NONE',
      status: 'UNMAPPED',
    });
  };

  const handleConfirm = (index: number) => {
    const result = results[index];
    if (!result.targetField) {
      return;
    }
    updateResult(index, {
      confidence: 'HIGH',
      status: 'AUTO_MAPPED',
    });
  };

  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Header Mapping Preview</h2>
          <p className="mt-1 text-sm text-slate-400">
            Review detected header mappings and adjust any ambiguous or unmapped fields before confirming.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-300">
          {requiredCheckSummary.allRequiredMapped ? (
            <span className="text-emerald-300">Required fields mapped</span>
          ) : (
            <span className="text-amber-300">Missing required mapping: {requiredCheckSummary.missingRequired.join(', ')}</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full table-auto border-collapse text-left text-sm text-slate-200">
          <thead>
            <tr className="border-b border-slate-700 text-slate-300">
              <th className="p-3">Source Header</th>
              <th className="p-3">Normalized Header</th>
              <th className="p-3">Detected Field</th>
              <th className="p-3">Confidence</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={`${result.sourceHeader}-${index}`} className="border-b border-slate-800">
                <td className="p-3 align-top text-slate-100">
                  {result.sourceHeader}
                  {REQUIRED_CANONICAL_FIELDS.includes(result.targetField as any) && (
                    <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">
                      Required
                    </span>
                  )}
                </td>
                <td className="p-3 align-top text-slate-400">{result.normalizedHeader || '—'}</td>
                <td className="p-3 align-top text-slate-100">
                  {result.targetField
                    ? canonicalFieldLabels[result.targetField]
                    : result.candidates[0]
                    ? canonicalFieldLabels[result.candidates[0].targetField]
                    : '—'}
                </td>
                <td className="p-3 align-top text-slate-100">{result.confidence}</td>
                <td className="p-3 align-top text-slate-100">{result.status.replace('_', ' ')}</td>
                <td className="p-3 align-top">
                  <div className="flex flex-col gap-2">
                    <select
                      value={result.targetField ?? ''}
                      onChange={(event) => handleTargetFieldChange(index, event.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
                    >
                      {fieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirm(index)}
                        disabled={!result.targetField}
                        className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm text-slate-100 transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => handleClear(index)}
                        className="rounded-2xl bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
