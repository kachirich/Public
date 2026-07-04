import Link from 'next/link';
import { listProfessionals } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { professionals } = await listProfessionals();

  return (
    <>
      <h1>Book a professional</h1>
      <div className="card">
        {professionals.length === 0 ? (
          <p>No professionals are available right now. Check back soon.</p>
        ) : (
          <ul className="plain">
            {professionals.map((p) => (
              <li key={p.id}>
                <Link className="row-link" href={`/professionals/${p.id}`}>
                  {p.display_name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
