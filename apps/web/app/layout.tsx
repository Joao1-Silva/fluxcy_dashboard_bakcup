import type { Metadata } from 'next';
import { Orbitron, Space_Grotesk } from 'next/font/google';

import { Providers } from '@/components/layout/providers';

import './globals.css';
import './theme/default.css';
import './theme/ios26.css';

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-heading',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'Fluxcy DEV V1 Dashboard',
  description: 'Dashboard BFF + Socket.IO para FLUXCY',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${orbitron.variable} ${spaceGrotesk.variable} theme-default min-h-screen bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}


