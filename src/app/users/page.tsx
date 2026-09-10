'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Role = { id: string; name: string; description?: string | null };
type User = { id: string; name: string; email: string; role_id: string; role: { id: string; name: string }; status: 'ACTIVE' | 'INACTIVE'; created_at: string; updated_at: string };
type UserResponse = { users: User[]; roles: Role[]; pagination: { page: number; pageSize: number; totalPages: number; totalCount: number } };
type FormState = { name: string; email: string; password: string; role_id: string; status: 'ACTIVE' | 'INACTIVE' };

const emptyForm: FormState = { name: '', email: '', password: '', role_id: '', status: 'ACTIVE' };

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalPages: 0, totalCount: 0 });
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (roleId) params.set('role_id', roleId);
      if (status) params.set('status', status);
      const response = await fetch(`/api/users?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) { router.replace('/login'); return; }
        throw new Error((await response.json()).error || 'Unable to load users');
      }
      const data: UserResponse = await response.json();
      setUsers(data.users); setRoles(data.roles); setPagination(data.pagination); setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users');
    } finally { setLoading(false); }
  }, [page, roleId, router, search, status]);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) { router.replace('/login'); return; }
      const data = await response.json();
      setCurrentUserId(data.user.id);
      if (!data.user.permissions.includes('manage_user')) setError('Permission denied');
      else fetchUsers();
    }).catch(() => router.replace('/login'));
  }, [fetchUsers, router]);

  function openCreate() {
    setEditing(null); setForm({ ...emptyForm, role_id: roles[0]?.id ?? '' }); setMessage(null); setError(null);
  }

  function openEdit(user: User) {
    setEditing(user); setForm({ name: user.name, email: user.email, password: '', role_id: user.role_id, status: user.status }); setMessage(null); setError(null);
  }

  async function saveUser(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(editing ? `/api/users/${editing.id}` : '/api/users', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, email: form.email, role_id: form.role_id, status: form.status, ...(editing ? {} : { password: form.password }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save user');
      setEditing(null); setForm(emptyForm); setMessage(editing ? 'User updated.' : 'User created.'); await fetchUsers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save user');
    } finally { setSaving(false); }
  }

  if (error === 'Permission denied') {
    return <main className="page-frame operational-page"><div className="mx-auto max-w-7xl"><div className="error-state">Permission denied.</div></div></main>;
  }

  return (
    <main className="page-frame operational-page">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><button onClick={() => router.push('/')} className="mb-3 text-sm text-slate-400 hover:text-slate-200">Back to dashboard</button><h1 className="text-3xl font-semibold">Users</h1><p className="mt-2 text-slate-400">Manage application access and roles.</p></div><button onClick={openCreate} disabled={!currentUserId || roles.length === 0} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">Create user</button></div>
        {message && <div className="mb-5 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-emerald-300">{message}</div>}
        {error && error !== 'Permission denied' && <div className="mb-5 rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-300">{error}</div>}
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-5"><div className="grid grid-cols-1 gap-4 md:grid-cols-4"><label className="text-sm text-slate-300 md:col-span-2">Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500" /></label><label className="text-sm text-slate-300">Role<select value={roleId} onChange={(event) => { setRoleId(event.target.value); setPage(1); }} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="">All roles</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="text-sm text-slate-300">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div></section>
        {loading ? <p className="text-slate-400">Loading users...</p> : <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900"><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-800 text-slate-300"><tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Email</th><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Created</th><th className="px-4 py-3 text-left">Action</th></tr></thead><tbody>{users.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No users found.</td></tr> : users.map((user) => <tr key={user.id} className="border-t border-slate-800"><td className="px-4 py-3 font-medium">{user.name}</td><td className="px-4 py-3 text-slate-300">{user.email}</td><td className="px-4 py-3 text-slate-300">{user.role.name}</td><td className="px-4 py-3"><span className={user.status === 'ACTIVE' ? 'text-emerald-300' : 'text-slate-400'}>{user.status}</span></td><td className="px-4 py-3 text-slate-400">{new Date(user.created_at).toLocaleDateString()}</td><td className="px-4 py-3"><button onClick={() => openEdit(user)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-600">Edit</button></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-sm text-slate-400"><span>Page {pagination.page} of {Math.max(1, pagination.totalPages)} ({pagination.totalCount} users)</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg bg-slate-800 px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg bg-slate-800 px-3 py-1.5 disabled:opacity-40">Next</button></div></div></section>}
        {currentUserId && (editing || form.role_id) && <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-6"><form onSubmit={saveUser} className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{editing ? 'Edit user' : 'Create user'}</h2><button type="button" onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-100">Close</button></div><div className="space-y-4"><label className="block text-sm text-slate-300">Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" /></label><label className="block text-sm text-slate-300">Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" /></label>{!editing && <label className="block text-sm text-slate-300">Password<input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" /></label>}<label className="block text-sm text-slate-300">Role<select required value={form.role_id} onChange={(event) => setForm({ ...form, role_id: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="block text-sm text-slate-300">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FormState['status'] })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="rounded-lg bg-slate-700 px-4 py-2">Cancel</button><button disabled={saving} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving...' : 'Save user'}</button></div></form></div>}
      </div>
    </main>
  );
}
