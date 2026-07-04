'use server';

import { redirect } from 'next/navigation';
import { ApiError, chooseCounterSlot, createQuote, findOrCreateClient, initPayment } from './api';

export interface ActionState {
  error: string | null;
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
