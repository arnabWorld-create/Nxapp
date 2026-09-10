'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', mobileNumber: '', city: '', password: '', confirmPassword: '', verificationCode: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Unable to create account');
        return;
      }
      router.replace('/login?registered=1');
    } catch {
      setError('Unable to connect to server');
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-page">
    <div className="login-layout register-layout">
      <section className="login-intro">
        <span className="login-mark">N</span>
        <p className="eyebrow">NX APP / SALES OPERATIONS</p>
        <h1>Clarity for every commercial decision.</h1>
        <p>Create a controlled sales workspace account for approved business operations.</p>
        <div className="login-trust"><span />Secure workspace <span />Role-aware access <span />Audit-ready records</div>
      </section>
      <section className="login-panel register-panel" aria-labelledby="register-title">
        <div className="login-panel-header">
          <p className="eyebrow">New account</p>
          <h2 id="register-title">Create your sales account</h2>
          <p>Use your work details to get started.</p>
        </div>
        {error && <div className="login-error" role="alert"><p>{error}</p></div>}
        <form onSubmit={handleSubmit} className="login-form register-form">
          <label>Full Name<input type="text" value={form.name} onChange={(event) => updateField('name', event.target.value)} required autoComplete="name" /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required autoComplete="email" placeholder="name@company.com" /></label>
          <label>Mobile Number<input type="tel" value={form.mobileNumber} onChange={(event) => updateField('mobileNumber', event.target.value)} required autoComplete="tel" inputMode="tel" placeholder="9876543210" /></label>
          <label>City<input type="text" value={form.city} onChange={(event) => updateField('city', event.target.value)} required autoComplete="address-level2" /></label>
          <div className="register-form-row"><label>Password<input type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} required minLength={8} autoComplete="new-password" /></label><label>Confirm Password<input type="password" value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} required minLength={8} autoComplete="new-password" /></label></div>
          <label>Company Verification Code<input type="password" value={form.verificationCode} onChange={(event) => updateField('verificationCode', event.target.value)} required autoComplete="off" /></label>
          <button type="submit" disabled={loading} className="primary-action login-submit">{loading ? 'Creating account...' : 'Create Account'}</button>
        </form>
        <p className="login-footer">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
    </div>
  </main>;
}