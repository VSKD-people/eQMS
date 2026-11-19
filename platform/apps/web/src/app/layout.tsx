import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VeQMS', template: '%s · VeQMS' },
  description: 'VeQMS electronic quality management system',
  icons: { icon: '/img/katalyze-marque-digital.svg' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@200;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
