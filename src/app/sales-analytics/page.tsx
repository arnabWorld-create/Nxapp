'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Metric = { salesQty: number; salesValue: number };
type Analytics = {
  scope: { salespersonId: string | null; salespersonName: string | null; canSelectSalesperson: boolean };
  summary: Metric & { previousSalesQty: number; previousSalesValue: number; salesValueChange: number | null };
  divisionBreakdown: Array<Metric & { divisionId: string; divisionName: string }>;
  productBreakdown: Array<Metric & { productId: string; productName: string; divisionName: string }>;
  monthlyTrend: Array<Metric & { month: string }>;
  salesMix: Array<Metric & { productId: string; productName: string; share: number }>;
  details: Array<Metric & { statementPeriodStart: string; statementPeriodEnd: string; divisionName: string; productName: string; sourceItemName: string; sourceRowNumber: number | null }>;
  salespersons: Array<{ id: string; name: string; email: string }>;
  divisions: Array<{ id: string; name: string }>;
  distributors: Array<{ id: string; name: string }>;
};

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

function TrendChart({ data }: { data: Analytics['monthlyTrend'] }) {
  if (data.length === 0) return <div className="empty-state">No approved sales in the selected period.</div>;
  const width = 760;
  const height = 220;
  const max = Math.max(...data.map((item) => item.salesValue), 1);
  const points = data.map((item, index) => ({ ...item, x: data.length === 1 ? width / 2 : index / (data.length - 1) * width, y: height - (item.salesValue / max) * (height - 28) - 10 }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  return <div className="analytics-chart" aria-label="Monthly sales value and quantity trend"><svg viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="none"><line className="chart-gridline" x1="0" y1="10" x2={width} y2="10" /><line className="chart-gridline" x1="0" y1={height / 2} x2={width} y2={height / 2} /><line className="chart-gridline" x1="0" y1={height - 1} x2={width} y2={height - 1} /><polyline points={line} fill="none" className="chart-line" />{points.map((point) => <circle key={point.month} cx={point.x} cy={point.y} r="4" className="chart-point" />)}</svg><div className="chart-labels">{points.map((point) => <span key={point.month}>{new Date(`${point.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span>)}</div><div className="chart-values">{points.map((point) => <span key={point.month}>{money.format(point.salesValue)}<small>{quantity.format(point.salesQty)} qty</small></span>)}</div></div>;
}

function DivisionBars({ data }: { data: Analytics['divisionBreakdown'] }) {
  if (data.length === 0) return <div className="empty-state">No division data in the selected period.</div>;
  const max = Math.max(...data.map((item) => item.salesValue), 1);
  return <div className="analytics-bars">{data.map((item) => <div className="analytics-bar-row" key={item.divisionId}><div><strong>{item.divisionName}</strong><small>{quantity.format(item.salesQty)} units</small></div><div className="analytics-bar-track"><i style={{ width: `${Math.max(item.salesValue / max * 100, 3)}%` }} /></div><b>{money.format(item.salesValue)}</b></div>)}</div>;
}

export default function SalesAnalyticsPage() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [salespersonId, setSalespersonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [distributorId, setDistributorId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useCallback(() => {
    const params = new URLSearchParams();
    if (salespersonId) params.set('salesperson_id', salespersonId);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (divisionId) params.set('division_id', divisionId);
    if (distributorId) params.set('distributor_id', distributorId);
    if (productSearch.trim()) params.set('product_search', productSearch.trim());
    return params.toString();
  }, [salespersonId, startDate, endDate, divisionId, distributorId, productSearch]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sales-analytics?${queryString()}`, { cache: 'no-store' });
      if (!response.ok) { if (response.status === 401) { router.replace('/login'); return; } throw new Error((await response.json()).error || 'Unable to load sales analytics'); }
      setAnalytics(await response.json()); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load sales analytics'); }
    finally { setLoading(false); }
  }, [queryString, router]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  async function exportAnalytics() {
    setExporting(true);
    try {
      const response = await fetch(`/api/sales-analytics/export?${queryString()}`);
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to export analytics');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'individual-sales-analytics.xlsx'; anchor.click(); URL.revokeObjectURL(url);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Unable to export analytics'); }
    finally { setExporting(false); }
  }

  function clearFilters() { setSalespersonId(''); setStartDate(''); setEndDate(''); setDivisionId(''); setDistributorId(''); setProductSearch(''); }

  return <main className="page-frame analytics-page"><header className="page-header"><div><p className="eyebrow">Sales performance</p><h1>Individual Sales Analytics</h1><p className="page-subtitle">Approved sales grouped by the user who uploaded the source data.</p></div><button onClick={exportAnalytics} disabled={exporting || loading} className="primary-action">{exporting ? 'Preparing Excel...' : 'Export XLSX'}</button></header>
    {analytics && <section className="filter-surface"><div className="filter-heading"><div><h2>Refine the view</h2><p>Adjust the scope without changing approved sales.</p></div><button className="secondary-action" onClick={clearFilters}>Clear filters</button></div><div className="filter-grid"><label>Salesperson{analytics.scope.canSelectSalesperson ? <select value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)}><option value="">All Salespersons</option>{analytics.salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select> : <span className="filter-readonly">{analytics.scope.salespersonName ?? 'Current user'}</span>}</label><label>Distributor<select value={distributorId} onChange={(event) => setDistributorId(event.target.value)}><option value="">All Distributors</option>{analytics.distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}</select></label><label>Period from<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Period to<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label>Division<select value={divisionId} onChange={(event) => setDivisionId(event.target.value)}><option value="">All divisions</option>{analytics.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label><label>Product search<input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search product name" /></label></div></section>}
    {error && <div className="error-state analytics-error">{error}</div>}{loading && <div className="loading-state analytics-loading">Loading sales analytics...</div>}
    {!loading && analytics && <><section className="analytics-kpis"><div className="analytics-kpi primary"><p>Total sales value</p><strong>{money.format(analytics.summary.salesValue)}</strong><small>{analytics.summary.salesValueChange === null ? 'No previous-period comparison' : `${analytics.summary.salesValueChange >= 0 ? '+' : ''}${analytics.summary.salesValueChange.toFixed(1)}% vs previous period`}</small></div><div className="analytics-kpi"><p>Total sales quantity</p><strong>{quantity.format(analytics.summary.salesQty)}</strong><small>Approved units</small></div><div className="analytics-kpi"><p>Reporting scope</p><strong>{analytics.distributors.find((distributor) => distributor.id === distributorId)?.name ?? 'All Distributors'}</strong><small>{analytics.scope.salespersonName ?? 'All Salespersons'}</small></div></section>
    <div className="analytics-grid"><section className="surface analytics-panel trend-panel"><div className="section-header"><h2>Monthly sales trend</h2><span className="panel-note">Sales value and quantity</span></div><TrendChart data={analytics.monthlyTrend} /></section><section className="surface analytics-panel"><div className="section-header"><h2>Division breakdown</h2><span className="panel-note">Visual comparison</span></div><DivisionBars data={analytics.divisionBreakdown} /></section></div>
    <section className="surface product-mix-panel"><div className="section-header"><div><h2>Division totals</h2><span className="panel-note">Reconciles to total sales value and quantity</span></div></div><DivisionSummary data={analytics.divisionBreakdown} total={analytics.summary.salesValue} /></section>
    <section className="surface product-mix-panel"><div className="section-header"><div><h2>Product sales mix</h2><span className="panel-note">Ranked by approved sales value</span></div></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Rank</th><th>Division</th><th>Product</th><th className="number">Sales quantity</th><th className="number">Sales value</th><th className="number">% of total</th></tr></thead><tbody>{analytics.productBreakdown.map((row, index) => <tr key={row.productId}><td>{index + 1}</td><td>{row.divisionName}</td><td><strong>{row.productName}</strong><div className="mix-track inline"><i style={{ width: `${Math.max(analytics.summary.salesValue ? row.salesValue / analytics.summary.salesValue * 100 : 0, 2)}%` }} /></div></td><td className="number">{quantity.format(row.salesQty)}</td><td className="number">{money.format(row.salesValue)}</td><td className="number">{(analytics.summary.salesValue ? row.salesValue / analytics.summary.salesValue * 100 : 0).toFixed(1)}%</td></tr>)}</tbody></table></div></section>
    <section className="surface detail-panel"><div className="section-header"><div><h2>Detailed sales rows</h2><span className="panel-note">All approved rows in the current view</span></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period</th><th>Division</th><th>Product</th><th>Source item</th><th className="number">Sales qty</th><th className="number">Sales value</th></tr></thead><tbody>{analytics.details.map((row, index) => <tr key={`${row.statementPeriodStart}-${row.sourceRowNumber}-${index}`}><td>{row.statementPeriodStart} to {row.statementPeriodEnd}</td><td>{row.divisionName}</td><td className="emphasis">{row.productName}</td><td>{row.sourceItemName}</td><td className="number">{quantity.format(row.salesQty)}</td><td className="number emphasis">{money.format(row.salesValue)}</td></tr>)}</tbody></table></div></section></>}
  </main>;
}

function DivisionSummary({ data, total }: { data: Analytics['divisionBreakdown']; total: number }) {
  if (data.length === 0) return <div className="empty-state">No division data in the selected period.</div>;
  const totalQty = data.reduce((sum, row) => sum + row.salesQty, 0);
  return <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Division</th><th className="number">Sales quantity</th><th className="number">Sales value</th><th className="number">Contribution</th></tr></thead><tbody>{data.map((row) => <tr key={row.divisionId}><td>{row.divisionName}</td><td className="number">{quantity.format(row.salesQty)}</td><td className="number">{money.format(row.salesValue)}</td><td className="number">{(total ? row.salesValue / total * 100 : 0).toFixed(1)}%</td></tr>)}</tbody><tfoot><tr><th>Grand Total</th><th className="number">{quantity.format(totalQty)}</th><th className="number">{money.format(total)}</th><th className="number">100.0%</th></tr></tfoot></table></div>;
}