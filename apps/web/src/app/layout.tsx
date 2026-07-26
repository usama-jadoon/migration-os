import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MigrationOS — Email & Workspace Migration Platform',
  description: 'Seamlessly migrate emails between Google Workspace, Microsoft 365, and IMAP providers with live progress tracking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
