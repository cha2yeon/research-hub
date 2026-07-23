import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Weekly Brief',
  description: 'A minimalist research report hub MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
