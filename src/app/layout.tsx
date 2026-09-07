import type { Metadata } from 'next';
import './globals.css';
import AppShell from '../components/AppShell';

export const metadata: Metadata = {
  title: 'NX APP',
  description: 'Statement-based sales CRM for brand-wise business data.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><script dangerouslySetInnerHTML={{ __html: "try { var theme = localStorage.getItem('nxapp-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; } catch (error) {}" }} /><AppShell>{children}</AppShell></body>
    </html>
  );
}
