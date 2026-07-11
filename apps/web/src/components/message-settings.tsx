'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/actions';
import { saveSettingsAction } from '@/lib/pro-actions';

const initial: ActionState = { error: null };

export function MessageSettings({
  directMessageFee,
  dmNote,
}: {
  directMessageFee: string;
  dmNote: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, initial);
  return (
    <form action={formAction}>
      <label htmlFor="directMessageFee">Message fee (KES)</label>
      <input
        id="directMessageFee"
        name="directMessageFee"
        type="number"
        min="0"
        step="1"
        defaultValue={Number(directMessageFee).toFixed(0)}
      />
      <p className="pro-affiliation">
        Clients pay this before a message reaches your WhatsApp. Raise it if you get too many; set 0
        to allow free messages.
      </p>

      <label htmlFor="dmNote">Note appended to every forwarded message (optional)</label>
      <textarea
        id="dmNote"
        name="dmNote"
        rows={2}
        maxLength={300}
        defaultValue={dmNote ?? ''}
        placeholder="e.g. I reply between 5–7pm on weekdays. For anything urgent, book a session."
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save message settings'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.saved && !state.error && <p className="verified">Saved.</p>}
    </form>
  );
}
