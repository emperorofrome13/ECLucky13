import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ECLucky13 v1.26', description: 'Reliable local-first AI coding agent (server-owned runs, streaming, change journal, project-aware verification)' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}













