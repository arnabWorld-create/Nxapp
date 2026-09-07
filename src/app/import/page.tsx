'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ImportUploadForm from '../../components/import/ImportUploadForm';

export default function ImportPage() {
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) router.replace('/login');
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  return (
    <main className="page-frame operational-page import-page">
      <div className="mx-auto max-w-4xl">
        <div className="import-page-header">
          <button type="button" onClick={() => router.push('/')} className="back-link">← Back to Dashboard</button>
          <p className="eyebrow">Data operations</p>
          <h1>Import Sales Statement</h1>
          <p className="page-subtitle">Upload a sales statement spreadsheet or CSV. The file will be parsed, validated, mapped, and prepared for review.</p>
        </div>

        <ImportUploadForm />
      </div>
    </main>
  );
}
