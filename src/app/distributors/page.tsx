'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Distributor = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; effective_from: string; effective_to: string | null; salesperson: { id: string; name: string; email: string } | null };
type User = { id: string; name: string; email: string };
type FormState = { name: string; salesperson_user_id: string; effective_from: string; effective_to: string; status: 'ACTIVE' | 'INACTIVE' };
const emptyForm: FormState = { name: '', salesperson_user_id: '', effective_from: new Date().toISOString().slice(0, 10), effective_to: '', status: 'ACTIVE' };

export default function DistributorsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Distributor[]>([]);
  const [salespersons, setSalespersons] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Distributor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function fetchItems() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (salespersonId) params.set('salesperson_id', salespersonId);
      if (status) params.set('status', status);
      const response = await fetch(`/api/distributors?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load distributors');
      setItems(data.distributors); setSalespersons(data.salespersons); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load distributors'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) { router.replace('/login'); return; }
      const data = await response.json();
      if (!data.user.permissions.includes('manage_product')) { setError('Permission denied'); return; }
      fetchItems();
    }).catch(() => router.replace('/login'));
  }, [router, search, salespersonId, status]);

  function openCreate() { setEditing(null); setForm(emptyForm); setShowForm(true); setMessage(null); setError(null); }
  function openEdit(item: Distributor) { setEditing(item); setShowForm(true); setForm({ name: item.name, salesperson_user_id: item.salesperson?.id || '', effective_from: item.effective_from, effective_to: item.effective_to || '', status: item.status }); setMessage(null); setError(null); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(editing ? `/api/distributors/${editing.id}` : '/api/distributors', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, salesperson_user_id: form.salesperson_user_id || null, effective_from: form.effective_from, effective_to: form.effective_to || null, status: form.status }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save distributor');
      setEditing(null); setShowForm(false); setForm(emptyForm); setMessage(editing ? 'Distributor updated.' : 'Distributor created.'); await fetchItems();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save distributor'); }
    finally { setSaving(false); }
  }

  return <main className="page-frame operational-page"><div className="mx-auto max-w-7xl">
    <div className="page-header"><div><p className="eyebrow">Data operations</p><h1>Distributors</h1><p className="page-subtitle">Manage distributor masters and salesperson assignments.</p></div><button onClick={openCreate} className="primary-action">+ Create Distributor</button></div>
    {message && <div className="mb-5 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-emerald-300">{message}</div>}{error && <div className="mb-5 rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>}
    <section className="filter-surface operational-filter"><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><label className="text-sm text-slate-300">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Distributor name" className="filter-control mt-2" /></label><label className="text-sm text-slate-300">Salesperson<select value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)} className="filter-control mt-2"><option value="">All salespeople</option>{salespersons.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="text-sm text-slate-300">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="filter-control mt-2"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div></section>
    {loading ? <p className="text-slate-400">Loading distributors...</p> : <section className="surface operational-table overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr className="bg-slate-800"><th>Distributor Name</th><th>Salesperson</th><th>Status</th><th>Effective From</th><th>Effective To</th><th>Action</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No distributors found.</td></tr> : items.map((item) => <tr key={item.id} className="border-b border-slate-800"><td>{item.name}</td><td>{item.salesperson?.name || '—'}</td><td className={item.status === 'ACTIVE' ? 'text-emerald-300' : 'text-slate-400'}>{item.status}</td><td>{item.effective_from}</td><td>{item.effective_to || '—'}</td><td><button onClick={() => openEdit(item)} className="secondary-action">Edit</button></td></tr>)}</tbody></table></section>}
    {showForm ? <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-6"><form onSubmit={save} className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{editing ? 'Edit Distributor' : 'Create Distributor'}</h2><button type="button" onClick={() => { setEditing(null); setShowForm(false); setForm(emptyForm); }}>Close</button></div><div className="space-y-4"><label className="block text-sm text-slate-300">Distributor Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="filter-control mt-2" /></label><label className="block text-sm text-slate-300">Salesperson<select value={form.salesperson_user_id} onChange={(event) => setForm({ ...form, salesperson_user_id: event.target.value })} className="filter-control mt-2"><option value="">Unassigned</option>{salespersons.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><div className="grid grid-cols-2 gap-4"><label className="text-sm text-slate-300">Effective From<input required type="date" value={form.effective_from} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} className="filter-control mt-2" /></label><label className="text-sm text-slate-300">Effective To<input type="date" value={form.effective_to} onChange={(event) => setForm({ ...form, effective_to: event.target.value })} className="filter-control mt-2" /></label></div><label className="block text-sm text-slate-300">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FormState['status'] })} className="filter-control mt-2"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div><button disabled={saving} className="primary-action mt-6">{saving ? 'Saving...' : 'Save Distributor'}</button></form></div> : null}
  </div></main>;
}
