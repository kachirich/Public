'use client';

import { useActionState } from 'react';
import { applyProfileAction, type ApplyState } from '@/lib/pro-actions';
import { CATEGORY_COPY } from '@/lib/display';

const initial: ApplyState = { error: null };

export function ApplyForm() {
  const [state, action, pending] = useActionState(applyProfileAction, initial);

  return (
    <form action={action}>
      <label htmlFor="displayName">Full name</label>
      <input id="displayName" name="displayName" required autoComplete="name" placeholder="Dr. Jane Doe" />

      <label htmlFor="whatsapp">WhatsApp number</label>
      <input id="whatsapp" name="whatsapp" type="tel" required autoComplete="tel" placeholder="+2547..." />

      <label htmlFor="category">Category</label>
      <select id="category" name="category" required defaultValue="">
        <option value="" disabled>
          Choose one
        </option>
        {Object.entries(CATEGORY_COPY).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="affiliation">Institution</label>
      <input id="affiliation" name="affiliation" placeholder="e.g. Kenyatta National Hospital" />

      <label htmlFor="title">Title</label>
      <input id="title" name="title" placeholder="e.g. Consultant Paediatrician" />

      <label htmlFor="bio">Short bio (optional)</label>
      <textarea id="bio" name="bio" rows={3} maxLength={500} />

      <button type="submit" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit application'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
