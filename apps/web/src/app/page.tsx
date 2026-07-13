import Link from 'next/link';
import { listProfessionals } from '@/lib/api';
import { CATEGORY_COPY, categoryLabel } from '@/lib/display';

export const dynamic = 'force-dynamic';

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Browse & pick a time',
    body: 'Filter by category or institution, then pick a slot — inside a professional’s normal hours or an off-duty premium request.',
  },
  {
    step: '2',
    title: 'Pay into escrow',
    body: 'Your payment is held, not released, until the session actually happens. Nobody gets paid for a no-show.',
  },
  {
    step: '3',
    title: 'Meet, then payout',
    body: 'The professional confirms on WhatsApp — no app to install. Once the session completes, escrow releases their payout automatically.',
  },
];

export default async function LandingPage() {
  const { professionals } = await listProfessionals();
  const institutions = new Set(professionals.map((p) => p.affiliation).filter(Boolean));

  const categoryCounts = Object.keys(CATEGORY_COPY).map((category) => ({
    category,
    count: professionals.filter((p) => p.category === category && p.is_available).length,
  }));

  return (
    <>
      <section className="hero">
        <h1>Professional access, on your schedule</h1>
        <p>
          Book paid time with verified doctors, lecturers, lawyers and more — even outside their
          normal availability. No app for them to install; they run everything from WhatsApp.
          Your payment stays in escrow until the session happens.
        </p>
        <div className="calendar-links">
          <Link className="button-link" href="/browse">
            Browse professionals
          </Link>
          <Link className="button-link button-secondary" href="/pro">
            For professionals
          </Link>
          {/* Sign-in goes through /pro so the AuthKit middleware gate supplies
              a returnTo and the user lands back in the portal after login,
              rather than stranding on the authkit-service profile page. */}
          <Link className="button-link button-secondary" href="/pro">
            Sign in
          </Link>
        </div>
        {professionals.length > 0 && (
          <p className="pro-affiliation">
            {professionals.length} verified professionals{institutions.size > 0 ? ` across ${institutions.size} institutions` : ''} already on the platform.
          </p>
        )}
      </section>

      <div className="card">
        <h2>How it works</h2>
        <div className="landing-steps">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="landing-step">
              <span className="landing-step-number" aria-hidden>
                {s.step}
              </span>
              <div>
                <strong>{s.title}</strong>
                <p className="pro-affiliation">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Browse by category</h2>
        <div className="landing-category-grid">
          {categoryCounts.map(({ category, count }) => (
            <Link key={category} className="landing-category-card" data-category={category} href={`/browse?category=${category.toLowerCase()}`}>
              <span className="chip" data-category={category}>
                {categoryLabel(category)}
              </span>
              <span className="pro-affiliation">{count} available now</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Verified, not just listed</h2>
        <p className="pro-affiliation">
          Every professional on the platform goes through registry verification against their
          professional body before they can be booked — the same hard gate applies whether they
          signed up themselves or were referred. Clients only ever see profiles that passed.
        </p>
        <Link className="button-link" href="/browse">
          Start browsing
        </Link>
      </div>
    </>
  );
}
