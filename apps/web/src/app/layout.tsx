import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Professional Access',
  description: 'Book sessions with professionals outside their normal availability.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authkitLoginUrl = process.env.AUTHKIT_LOGIN_URL || 'http://localhost:4000/login.html';

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Professional Access
          </Link>
          <nav className="header-nav">
            <Link href="/pro">For professionals</Link>
            <a href={authkitLoginUrl}>Sign in</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
