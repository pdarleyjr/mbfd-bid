import type { Metadata, Viewport } from 'next';
import { StagingBanner } from './_components/StagingBanner';
import './globals.css';
import { cfEnv } from '../lib/cf-env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'MBFD Bid',
  description: 'Miami Beach Fire Department — Annual Shift Bid',
  robots: { index: false, follow: false }, // unlisted; PIN-gated
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#1e293b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const environment = cfEnv('ENV');

  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-800 antialiased">
        <StagingBanner environment={environment} />
        {children}
      </body>
    </html>
  );
}
