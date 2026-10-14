'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If already authenticated, redirect to home
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          router.replace('/');
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Login failed');
        return;
      }

      router.replace('/');
      router.refresh();
    } catch (err) {
      setError('Unable to connect to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="login-page login-loading">
        <p>Loading secure workspace...</p>
      </div>
    );
  }

  return (
    <main className="login-page">
      <div className="login-layout">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-header">
            <p className="eyebrow">Welcome back</p>
            <h2 id="login-title">Sign in to NX APP</h2>
            <p>Use your work account to continue.</p>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <label>Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="name@company.com"
              />
            </label>
            <label>Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="primary-action login-submit"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="login-footer">Access is managed by your NX APP role and permissions.</p>
          <p className="login-footer"><Link href={'/register' as any}>Request access</Link></p>
        </section>
      </div>
    </main>
  );
}