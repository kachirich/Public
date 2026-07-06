import Link from 'next/link';
import { AvailabilityEditor } from '@/components/availability-editor';
import { ServiceAvailabilityEditor } from '@/components/service-availability-editor';
import { MessageSettings } from '@/components/message-settings';
import { getProAvailability, getProSettings, listProSessions } from '@/lib/api';
import { categoryLabel, formatMoney, formatWhen, initials } from '@/lib/display';
import { proLogoutAction, requireOwnedProfessional, togglePrivacyAction, toggleStatusAction } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

export default async function ProDashboardPage() {
  const professional = await requireOwnedProfessional();
  const professionalId = professional.id;

  const [availability, { sessions }, settings] = await Promise.all([
    getProAvailability(professionalId),
    listProSessions(professionalId),
    getProSettings(professionalId),
  ]);

  return (
    <>
      <div className="card pro-header">
        <span className="avatar avatar-lg" data-category={professional.category} aria-hidden>
          {initials(professional.display_name)}
        </span>
        <div style={{ flex: 1 }}>
          <h1>{professional.display_name}</h1>
          <p className="pro-header-meta">
            <span className="chip" data-category={professional.category}>
              {categoryLabel(professional.category)}
            </span>
            {professional.business_name && <span>{professional.business_name}</span>}
            {professional.affiliation && <span>{professional.affiliation}</span>}
          </p>
          {professional.provider_type !== 'SERVICE' && <p className="verified">✓ Verified professional</p>}
          <p className="pro-header-meta">
            <span className="status-dot" data-available={professional.is_available}>
              {professional.is_available ? 'Available — clients can book you' : 'Not available — bookings paused'}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <form action={toggleStatusAction}>
            <input type="hidden" name="available" value={String(!professional.is_available)} />
            <button type="submit" className={professional.is_available ? 'button-secondary-solid' : undefined}>
              {professional.is_available ? 'Pause bookings' : 'Go available'}
            </button>
          </form>
          <form action={proLogoutAction}>
            <button type="submit" className="button-secondary-solid">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Your QR poster</h2>
        <p className="pro-affiliation">
          Print this and post it at your office or department. Anyone who scans it lands straight on
          your booking page — no searching, no typing.
        </p>
        <div className="calendar-links">
          <Link className="button-link" href="/pro/poster">
            Open printable poster
          </Link>
          <a className="button-link button-secondary" href={`/api/professionals/${professionalId}/qr?format=png`} download>
            Download QR image
          </a>
        </div>
      </div>

      {professional.provider_type === 'SERVICE' ? (
        <div className="card">
          <h2>Your open hours &amp; capacity</h2>
          <p className="pro-affiliation">
            Clients can only book inside these windows. Capacity is how many clients you can take at
            the same time in a window — bookings keep landing until it is full.
          </p>
          <ServiceAvailabilityEditor initialSlots={availability.slots} consentedAt={availability.consentedAt} />
        </div>
      ) : (
        <div className="card">
          <h2>Your weekly availability</h2>
          <p className="pro-affiliation">
            Sessions requested inside these hours are quoted at the standard rate; anything outside is
            a premium off-duty request that you can still accept, decline, or counter on WhatsApp.
          </p>
          <AvailabilityEditor initialSlots={availability.slots} consentedAt={availability.consentedAt} />
        </div>
      )}

      <div className="card">
        <h2>Location privacy</h2>
        <p className="pro-affiliation">
          Clients always see your institution ({professional.affiliation ?? 'not set'}). Your area
          {settings.locationArea ? ` (${settings.locationArea})` : ''} is only shown if you opt in —
          it stays hidden by default.
        </p>
        <form action={togglePrivacyAction}>
          <input type="hidden" name="showLocation" value={String(!settings.showLocation)} />
          <p className="pro-header-meta">
            <span className="status-dot" data-available={settings.showLocation}>
              {settings.showLocation ? 'Area visible to clients' : 'Area hidden from clients'}
            </span>
          </p>
          <button type="submit" className={settings.showLocation ? 'button-secondary-solid' : undefined}>
            {settings.showLocation ? 'Hide my area' : 'Show my area to clients'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Messages &amp; spam protection</h2>
        <p className="pro-affiliation">
          Clients can&apos;t WhatsApp you directly — booking requests only reach you after payment is in
          escrow, and one-off questions cost the fee below. Irrelevant messages stop before they
          reach your phone.
        </p>
        <MessageSettings directMessageFee={settings.directMessageFee} dmNote={settings.dmNote} />
      </div>

      <div className="card">
        <h2>Upcoming sessions</h2>
        {sessions.length === 0 ? (
          <p className="pro-affiliation">No booked sessions yet. You&apos;ll be pinged on WhatsApp when a request comes in.</p>
        ) : (
          <ul className="plain">
            {sessions.map((s) => (
              <li key={s.id} className="session-row">
                <div>
                  <strong>{s.client_name}</strong> · #{s.ref_code}
                  {s.source === 'qr' && <span className="chip source-tag"> via QR</span>}
                  <div className="pro-affiliation">
                    {formatWhen(s.session_start)} · {s.duration_minutes} min · you earn{' '}
                    {formatMoney(s.payout_net, s.currency)}
                  </div>
                </div>
                <span className="state-badge">{s.state.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
