import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listProfessionals } from '@/lib/api';
import { categoryLabel, initials } from '@/lib/display';

export const dynamic = 'force-dynamic';

// Development test console: one page from which every UI in the system is
// reachable — the client marketplace, each professional's public page, and
// each professional's portal (one-click sign-in via /pro/dev-login).
// Hard-disabled outside development.
export default async function DevConsolePage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { professionals } = await listProfessionals();

  return (
    <>
      <section className="hero">
        <h1>🧪 Dev test console</h1>
        <p>Jump into any side of the app without hunting for credentials. Development only.</p>
      </section>

      <div className="card">
        <h2>Client side</h2>
        <ul className="plain">
          <li>
            <Link className="row-link" href="/browse">
              Marketplace browse (categories + area filter)
            </Link>
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Professionals — view as client or open their portal</h2>
        <ul className="plain">
          {professionals.map((p) => (
            <li key={p.id} className="session-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <span className="avatar" data-category={p.category} aria-hidden>
                  {initials(p.display_name)}
                </span>
                <div>
                  <strong>{p.display_name}</strong>{' '}
                  <span className="chip" data-category={p.category}>
                    {categoryLabel(p.category)}
                  </span>{' '}
                  <span className="status-dot" data-available={p.is_available}>
                    {p.is_available ? 'Available' : 'Not available'}
                  </span>
                  <div className="pro-affiliation">{p.affiliation}</div>
                </div>
              </div>
              <div className="dev-links">
                <Link href={`/professionals/${p.id}`}>Public page</Link>
                <a href={`/pro/dev-login?id=${p.id}`}>Open portal →</a>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>How the dev payment works</h2>
        <p className="pro-affiliation">
          No provider keys are set, so &quot;Pay now&quot; and message fees route through a local stub that
          instantly confirms and redirects back — the same state transitions a real M-Pesa STK
          callback would fire. Configure MPESA_* env vars to hit the Daraja sandbox instead.
        </p>
      </div>
    </>
  );
}
