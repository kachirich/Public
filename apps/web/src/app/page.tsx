import Link from 'next/link';
import { listInstitutions, listProfessionals, type Professional } from '@/lib/api';
import { CATEGORY_COPY, categoryLabel, initials } from '@/lib/display';

export const dynamic = 'force-dynamic';

function ProfessionalCard({ p }: { p: Professional }) {
  return (
    <Link className="pro-card" href={`/professionals/${p.id}`}>
      <span className="avatar" data-category={p.category} aria-hidden>
        {initials(p.display_name)}
      </span>
      <span className="pro-card-body">
        <span className="pro-card-top">
          <strong>{p.display_name}</strong>
          <span className="chip" data-category={p.category}>
            {categoryLabel(p.category)}
          </span>
          <span className="status-dot" data-available={p.is_available}>
            {p.is_available ? 'Available' : 'Not available'}
          </span>
        </span>
        {p.title && <span className="pro-title">{p.title}</span>}
        {p.affiliation && <span className="pro-affiliation">{p.affiliation}</span>}
        {p.location_area && <span className="pro-location">📍 {p.location_area}</span>}
        {p.bio && <span className="pro-bio">{p.bio}</span>}
        <span className="verified">✓ Verified professional</span>
      </span>
    </Link>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; institution?: string }>;
}) {
  const { category, institution } = await searchParams;
  const active = category?.toUpperCase();
  const [{ professionals }, { institutions }] = await Promise.all([
    listProfessionals({ ...(active ? { category: active } : {}), ...(institution ? { institution } : {}) }),
    listInstitutions(active),
  ]);

  const withParams = (next: { category?: string; institution?: string }) => {
    const params = new URLSearchParams();
    const cat = 'category' in next ? next.category : category;
    // Institutions are category-scoped, so switching category always clears a
    // previously-picked institution — it may not exist in the new category.
    const inst = 'category' in next ? next.institution : 'institution' in next ? next.institution : institution;
    if (cat) params.set('category', cat);
    if (inst) params.set('institution', inst);
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  };

  return (
    <>
      <section className="hero">
        <h1>Book time with verified professionals</h1>
        <p>
          Doctors, lecturers, lawyers and more — even outside their normal availability. Your payment
          stays in escrow until the session happens.
        </p>
      </section>

      <nav className="category-filter" aria-label="Filter by category">
        <Link className="chip chip-filter" data-active={!active} href={withParams({ category: undefined })}>
          All
        </Link>
        {Object.entries(CATEGORY_COPY).map(([c, copy]) => (
          <Link
            key={c}
            className="chip chip-filter"
            data-active={active === c}
            data-category={c}
            href={withParams({ category: c.toLowerCase() })}
          >
            {copy.plural}
          </Link>
        ))}
      </nav>

      <nav className="area-filter" aria-label="Filter by institution">
        <span className="area-filter-label">🏛️ Institution:</span>
        <Link className="chip chip-filter" data-active={!institution} href={withParams({ institution: undefined })}>
          All institutions
        </Link>
        {institutions.map((inst) => (
          <Link
            key={inst}
            className="chip chip-filter"
            data-active={institution === inst}
            href={withParams({ institution: inst })}
          >
            {inst}
          </Link>
        ))}
      </nav>

      {professionals.length === 0 ? (
        <div className="card">
          <p>No professionals match those filters yet. Try widening your search.</p>
        </div>
      ) : (
        <div className="pro-grid">
          {professionals.map((p) => (
            <ProfessionalCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </>
  );
}
