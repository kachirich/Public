import { redirect } from 'next/navigation';
import { adminLogoutAction, decideVerificationAction, isAdmin, setActiveAction } from '@/lib/admin-actions';
import { listAllProfessionals, listPendingVerifications } from '@/lib/admin-api';
import { categoryLabel, formatWhen } from '@/lib/display';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  if (!(await isAdmin())) redirect('/admin');
  const [{ pending }, { professionals }] = await Promise.all([listPendingVerifications(), listAllProfessionals()]);

  return (
    <>
      <div className="card pro-header">
        <div style={{ flex: 1 }}>
          <h1>Admin dashboard</h1>
          <p className="pro-affiliation">
            {pending.length} verification{pending.length === 1 ? '' : 's'} awaiting review · {professionals.length}{' '}
            professionals on the books
          </p>
        </div>
        <form action={adminLogoutAction}>
          <button type="submit" className="button-secondary-solid">
            Sign out
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Verification review queue</h2>
        {pending.length === 0 ? (
          <p className="pro-affiliation">Queue is clear — nothing waiting for manual review.</p>
        ) : (
          <ul className="plain">
            {pending.map((v) => (
              <li key={v.id} className="session-row">
                <div>
                  <strong>{v.submitted_name}</strong>
                  <div className="pro-affiliation">
                    {v.registry} · reg no. {v.registration_number} · submitted {formatWhen(v.created_at)}
                  </div>
                  <div className="pro-affiliation">
                    Registry name: {v.registry_name ?? '—'} · match:{' '}
                    {v.name_match_score ? `${Math.round(Number(v.name_match_score) * 100)}%` : '—'} · WhatsApp OTP:{' '}
                    {v.whatsapp_otp_passed ? '✓ passed' : '✗ not confirmed'}
                  </div>
                </div>
                <div className="dev-links">
                  <form action={decideVerificationAction}>
                    <input type="hidden" name="verificationId" value={v.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <button type="submit" className="button-inline">
                      Approve
                    </button>
                  </form>
                  <form action={decideVerificationAction}>
                    <input type="hidden" name="verificationId" value={v.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <button type="submit" className="button-inline button-danger">
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Professionals</h2>
        <ul className="plain">
          {professionals.map((p) => (
            <li key={p.id} className="session-row">
              <div>
                <strong>{p.display_name}</strong>{' '}
                <span className="chip" data-category={p.category}>
                  {categoryLabel(p.category)}
                </span>
                <div className="pro-affiliation">
                  {p.affiliation ?? '—'} · {p.whatsapp_e164} · {p.verification_status.replace(/_/g, ' ')}
                  {!p.is_available && p.is_active ? ' · bookings paused' : ''}
                </div>
              </div>
              <form action={setActiveAction}>
                <input type="hidden" name="professionalId" value={p.id} />
                <input type="hidden" name="active" value={String(!p.is_active)} />
                <button type="submit" className={`button-inline${p.is_active ? ' button-danger' : ''}`}>
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
