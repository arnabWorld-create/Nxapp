'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ComboTrendChart from '../components/charts/ComboTrendChart';

type Metric = { salesQty: number; salesValue: number };
type DashboardResponse = {
  metrics: { totalStatements: number; totalImports: number; pendingImports: number; reviewRequiredImports: number; totalSalesValue: string; totalSalesQuantity: number; salesValueChange: number | null };
  divisionBreakdown: Array<Metric & { divisionId: string; divisionName: string }>;
  productBreakdown: Array<Metric & { productId: string; productName: string; divisionName: string }>;
  monthlyTrend: Array<Metric & { month: string }>;
  salespersonContribution: Array<{ user_id: string; user_name: string; sales_value: number }>;
  recentStatements: Array<{ id: string; source_file_name: string; period_start_date: string; period_end_date: string; status: string; created_at: string; row_count: number }>;
  recentImports: Array<{ id: string; file_name: string; status: string; created_at: string; row_count: number }>;
};

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'APPROVED' || status === 'COMMITTED' ? 'success' : status === 'FAILED' ? 'danger' : status === 'READY_FOR_REVIEW' ? 'warning' : 'neutral';
  return <span className={`status-badge ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="section-header"><h2>{title}</h2>{action && <button className="text-action" onClick={onAction}>{action} <span aria-hidden="true">-&gt;</span></button>}</div>;
}

function Kpi({ label, value, detail, accent = '' }: { label: string; value: string; detail?: string; accent?: string }) {
  return <div className={`kpi ${accent}`}><p>{label}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export default function HomePage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [role, setRole] = useState('');
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load dashboard');
      setDashboard(data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) { router.replace('/login'); return; }
      const authData = await response.json();
      setRole(authData.user.role);
      setUserName(authData.user.name);
      fetchDashboard();
    }).catch(() => router.replace('/login'));
  }, [fetchDashboard, router]);

  if (loading) return <main className="page-frame"><div className="loading-state">Loading dashboard...</div></main>;
  if (error) return <main className="page-frame"><div className="error-state">{error}</div></main>;
  if (!dashboard) return null;

  const { metrics, divisionBreakdown, productBreakdown, monthlyTrend, salespersonContribution, recentStatements, recentImports } = dashboard;
  const maxTrend = Math.max(...monthlyTrend.map((item) => item.salesValue), 1);
  const maxDivision = Math.max(...divisionBreakdown.map((item) => item.salesValue), 1);
  const isManager = role === 'ADMIN' || role === 'MANAGER';
  const attentionCount = metrics.pendingImports + metrics.reviewRequiredImports;

  return <main className="page-frame dashboard-page">
    <header className="page-header"><div><p className="eyebrow">{isManager ? 'Commercial overview' : 'My business overview'}</p><h1>{isManager ? 'Good morning' : `Good morning, ${userName}`}</h1><p className="page-subtitle">A focused view of approved sales and the work that needs your attention.</p></div><button className="primary-action" onClick={() => router.push('/import')}>+ New import</button></header>
    <section className="kpi-grid" aria-label="Sales summary">
      <Kpi label="Sales value" value={money.format(Number(metrics.totalSalesValue))} detail={metrics.salesValueChange === null ? 'No previous period' : `${metrics.salesValueChange >= 0 ? '+' : ''}${metrics.salesValueChange.toFixed(1)}% vs previous period`} accent="primary" />
      <Kpi label="Sales quantity" value={quantity.format(metrics.totalSalesQuantity)} detail="Approved units" />
      <Kpi label="Statements" value={String(metrics.totalStatements)} detail="Approved statements" />
      <Kpi label="Imports" value={String(metrics.totalImports)} detail="Source files in scope" />
    </section>
    {attentionCount > 0 && <section className="attention-strip"><span className="attention-mark">!</span><div><strong>Attention required</strong><span>{metrics.pendingImports > 0 ? `${metrics.pendingImports} processing` : ''}{metrics.pendingImports > 0 && metrics.reviewRequiredImports > 0 ? ' · ' : ''}{metrics.reviewRequiredImports > 0 ? `${metrics.reviewRequiredImports} ready for review` : ''}</span></div><button className="text-action" onClick={() => router.push('/imports')}>Review imports -&gt;</button></section>}
    <div className="dashboard-grid">
      <section className="surface trend-surface"><div className="section-header"><div><h2>Sales trend</h2><span className="panel-note">Sales value and quantity over time</span></div><button className="text-action" onClick={() => router.push('/sales-analytics')}>View analytics <span aria-hidden="true">-&gt;</span></button></div><ComboTrendChart data={monthlyTrend.slice(-6)} /></section>
      <section className="surface breakdown-surface"><SectionHeader title="Sales by division" />{divisionBreakdown.length === 0 ? <div className="empty-state">No division data in the current scope.</div> : <div className="breakdown-list">{[...divisionBreakdown].sort((a, b) => b.salesValue - a.salesValue).slice(0, 6).map((item) => <div className="breakdown-row" key={item.divisionId}><div><strong>{item.divisionName}</strong><small>{quantity.format(item.salesQty)} units</small></div><span><b>{money.format(item.salesValue)}</b><i style={{ width: `${Math.max((item.salesValue / maxDivision) * 100, 4)}%` }} /></span></div>)}</div>}</section>
    </div>
    <div className="dashboard-grid lower-grid">
      <section className="surface"><SectionHeader title="Top products" action="Products" onAction={() => router.push('/products')} />{productBreakdown.length === 0 ? <div className="empty-state">No product sales in the current scope.</div> : <div className="compact-table"><div className="compact-table-head"><span>Product</span><span>Sales value</span></div>{productBreakdown.slice(0, 5).map((item) => <div className="compact-table-row" key={item.productId}><div><strong>{item.productName}</strong><small>{item.divisionName}</small></div><span>{money.format(item.salesValue)}</span></div>)}</div>}</section>
      {isManager && <section className="surface"><SectionHeader title="Salesperson contribution" action="Sales analytics" onAction={() => router.push('/sales-analytics')} />{salespersonContribution.length === 0 ? <div className="empty-state">No salesperson contribution to show.</div> : <div className="compact-table">{salespersonContribution.map((item) => <div className="compact-table-row" key={item.user_id}><div><strong>{item.user_name}</strong><small>Approved sales</small></div><span>{money.format(item.sales_value)}</span></div>)}</div>}</section>}
      <section className={`surface ${isManager ? '' : 'wide-surface'}`}><SectionHeader title="Recent activity" action="View all" onAction={() => router.push('/statements')} />{recentStatements.length === 0 && recentImports.length === 0 ? <div className="empty-state">No recent activity.</div> : <div className="activity-list">{[...recentStatements.slice(0, 3).map((item) => ({ id: item.id, label: item.source_file_name, meta: 'Statement', status: item.status, date: item.created_at })), ...recentImports.slice(0, 3).map((item) => ({ id: item.id, label: item.file_name, meta: 'Import', status: item.status, date: item.created_at }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((item) => <div className="activity-row" key={`${item.meta}-${item.id}`}><div><strong>{item.label}</strong><small>{item.meta} · {new Date(item.date).toLocaleDateString()}</small></div><StatusBadge status={item.status} /></div>)}</div>}</section>
    </div>
    <div className="quick-actions"><span>Common actions</span><button onClick={() => router.push('/import')}>New import</button><button onClick={() => router.push('/statements')}>Browse statements</button><button onClick={() => router.push('/sales-analytics')}>Open analytics</button></div>
  </main>;
}