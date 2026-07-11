'use server';

import { redirect } from 'next/navigation';
import { ApiError, chooseCounterSlot, createQuote, findOrCreateClient, initPayment, sendDirectMessage } from './api';

export interface ActionState {
  error: string | null;
  saved?: boolean;
}

// Booking form -> quote (a REQUESTED request) -> its status page, which
// shows the price breakdown and the Pay button.
export async function bookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professionalId = String(formData.get('professionalId'));
  const displayName = String(formData.get('displayName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const sessionStart = String(formData.get('sessionStart') ?? '');
  const durationMinutes = Number(formData.get('durationMinutes') ?? 60);
  const brief = String(formData.get('brief') ?? '').trim();
  const source = String(formData.get('source') ?? '') === 'qr' ? 'qr' : undefined;

  if (!displayName || !email || !sessionStart || !brief) {
    return { error: 'Name, email, session time, and a brief are required.' };
  }

  let requestId: string;
  try {
    const { clientId } = await findOrCreateClient({ displayName, email, ...(phone ? { phone } : {}) });
    const quote = await createQuote({
      clientId,
      professionalId,
      sessionStart: new Date(sessionStart).toISOString(),
      durationMinutes,
      brief,
      ...(source ? { source } : {}),
    });
    requestId = quote.requestId;
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Something went wrong creating your quote.' };
  }
  redirect(`/requests/${requestId}`);
}

export async function payAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requestId = String(formData.get('requestId'));
  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await initPayment(requestId));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Payment could not be started.' };
  }
  redirect(authorizationUrl);
}

// Paid direct message ("ask a question first"): create the client, create
// the unpaid message, then hand off to the payment provider. The message is
// only forwarded to the professional once the fee clears — that's the spam gate.
export async function askAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professionalId = String(formData.get('professionalId'));
  const displayName = String(formData.get('displayName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const source = String(formData.get('source') ?? '') === 'qr' ? 'qr' : undefined;
  if (!displayName || !email || !body) {
    return { error: 'Name, email, and a message are required.' };
  }
  let authorizationUrl: string;
  try {
    const { clientId } = await findOrCreateClient({ displayName, email, ...(phone ? { phone } : {}) });
    ({ authorizationUrl } = await sendDirectMessage(professionalId, { clientId, body, ...(source ? { source } : {}) }));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Something went wrong sending your message.' };
  }
  redirect(authorizationUrl);
}

export async function chooseSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const counterOfferId = String(formData.get('counterOfferId'));
  const slotId = String(formData.get('slotId'));
  try {
    await chooseCounterSlot(counterOfferId, slotId);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'That slot could not be booked.' };
  }
  return { error: null };
}
