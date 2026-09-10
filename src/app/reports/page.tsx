'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Totals = { purchaseQuantity: number; purchaseValue: number; salesQuantity: number; salesValue: number; closingStockQuantity: number; closingStockValue: number };
type ReportRow = Totals & { divisionId: string; divisionName: string; productId: string; productName: string };
type DivisionTotal = Totals & { divisionId: string; divisionName: string };
type Report = { rows: ReportRow[]; divisionTotals: DivisionTotal[]; grandTotal: Totals };

type Division = { id: string; name: string };
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const moneyFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Metric({ value, money = false }: { value: number; money?: boolean }) {
  return <span className="whitespace-nowrap">{(money ? moneyFormat : numberFormat).format(value)}</span>;
}

export default function ReportsPage() {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (divisionId) params.set('division_id', divisionId);
    if (productSearch.trim()) params.set('product_search', productSearch.trim());
    return params.toString();
  }, [startDate, endDate, divisionId, productSearch]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reports/statements?${queryString()}`, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) { router.replace('/login'); return; }
        const body = await response.json();
        throw new Error(body.error || 'Unable to load report');
      }
      setReport(await response.json());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load report');
    } finally {
      setLoading(false);
    }
  }, [queryString, router]);

  useEffect(() => {
    fetch('/api/divisions?limit=100', { cache: 'no-store' }).then(async (response) => {
      if (response.ok) setDivisions((await response.json()).divisions);
    }).catch(() => undefined);
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  async function exportReport() {
    setExporting(true);
    try {
      const response = await fetch(`/api/reports/statements/export?${queryString()}`);
      if (!response.ok) throw new Error('Unable to export report');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'statement-report.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Unable to export report');
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setStartDate(''); setEndDate(''); setDivisionId(''); setProductSearch('');
  }

  return (
    <main className="page-frame analytics-page">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div><button onClick={() => router.push('/')} className="mb-3 text-sm text-slate-400 hover:text-slate-200">Back to dashboard</button><h1 className="text-3xl font-semibold">Statement Reporting</h1><p className="mt-2 text-slate-400">Approved statement results grouped by product and division.</p></div>
          <button onClick={exportReport} disabled={exporting || loading} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{exporting ? 'Preparing Excel...' : 'Export XLSX'}</button>
        </div>
        <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm text-slate-300">Period from<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100" /></label>
            <label className="text-sm text-slate-300">Period to<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100" /></label>
            <label className="text-sm text-slate-300">Division<select value={divisionId} onChange={(event) => setDivisionId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="">All divisions</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label>
            <label className="text-sm text-slate-300">Product search<input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search product name" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500" /></label>
            <button onClick={clearFilters} className="self-end rounded-lg bg-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-600">Clear filters</button>
          </div>
        </section>
        {error && <div className="mb-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>}
        {loading && <p className="text-slate-400">Loading approved statement report...</p>}
        {!loading && report && <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-right text-sm"><thead className="bg-slate-800 text-slate-300"><tr><th className="px-4 py-3 text-left">Division</th><th className="px-4 py-3 text-left">Product</th><th className="px-4 py-3">Purchase Qty</th><th className="px-4 py-3">Purchase Value</th><th className="px-4 py-3">Sales Qty</th><th className="px-4 py-3">Sales Value</th><th className="px-4 py-3">Closing Qty</th><th className="px-4 py-3">Closing Value</th></tr></thead><tbody>{report.divisionTotals.map((division) => <Fragment key={division.divisionId}>{report.rows.filter((row) => row.divisionId === division.divisionId).map((row) => <tr key={row.productId} className="border-t border-slate-800"><td className="px-4 py-3 text-left text-slate-400">{row.divisionName}</td><td className="px-4 py-3 text-left font-medium">{row.productName}</td><td className="px-4 py-3"><Metric value={row.purchaseQuantity} /></td><td className="px-4 py-3"><Metric value={row.purchaseValue} money /></td><td className="px-4 py-3"><Metric value={row.salesQuantity} /></td><td className="px-4 py-3"><Metric value={row.salesValue} money /></td><td className="px-4 py-3"><Metric value={row.closingStockQuantity} /></td><td className="px-4 py-3"><Metric value={row.closingStockValue} money /></td></tr>)}<tr key={`${division.divisionId}-total`} className="border-t border-slate-700 bg-slate-800/70 font-semibold"><td colSpan={2} className="px-4 py-3 text-left">{division.divisionName} total</td><td className="px-4 py-3"><Metric value={division.purchaseQuantity} /></td><td className="px-4 py-3"><Metric value={division.purchaseValue} money /></td><td className="px-4 py-3"><Metric value={division.salesQuantity} /></td><td className="px-4 py-3"><Metric value={division.salesValue} money /></td><td className="px-4 py-3"><Metric value={division.closingStockQuantity} /></td><td className="px-4 py-3"><Metric value={division.closingStockValue} money /></td></tr></Fragment>)}<tr className="border-t-2 border-emerald-500 bg-emerald-950/40 font-bold"><td colSpan={2} className="px-4 py-4 text-left">Grand total</td><td className="px-4 py-4"><Metric value={report.grandTotal.purchaseQuantity} /></td><td className="px-4 py-4"><Metric value={report.grandTotal.purchaseValue} money /></td><td className="px-4 py-4"><Metric value={report.grandTotal.salesQuantity} /></td><td className="px-4 py-4"><Metric value={report.grandTotal.salesValue} money /></td><td className="px-4 py-4"><Metric value={report.grandTotal.closingStockQuantity} /></td><td className="px-4 py-4"><Metric value={report.grandTotal.closingStockValue} money /></td></tr></tbody></table></div>{report.rows.length === 0 && <p className="p-8 text-center text-slate-400">No approved statement data matches these filters.</p>}</section>}
      </div>
    </main>
  );
}
