// Message templates as pure functions (payload) => string.
//
// Rules enforced here by construction:
// - professional-facing money is always the NET payout, never gross
// - client-facing money is always GROSS
// - client contact details never appear in professional-facing templates:
//   the payload types simply have no fields for them (ROOM_WELCOME is the
//   exception — a consult room exists by then)
// - every professional-facing template carries the #REF code

export interface Money {
  amount: string;
  currency: string;
}

function money(m: Money): string {
  return `${m.currency} ${m.amount}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Nairobi',
    hour12: false,
  });
}

// ---------- professional-facing ----------

export interface RequestCardPayload {
  refCode: string;
  sessionStart: string;
  durationMinutes: number;
  tier: string;
  payoutNet: string;
  currency: string;
  expiresAt: string;
  brief: string;
}

export function REQUEST_CARD(p: RequestCardPayload): string {
  return [
    `New session request #${p.refCode}`,
    ``,
    `When: ${when(p.sessionStart)} (${p.durationMinutes} min)`,
    `Type: ${p.tier.replace(/_/g, ' ').toLowerCase()}`,
    `You earn: ${money({ amount: p.payoutNet, currency: p.currency })}`,
    `Brief: ${p.brief}`,
    ``,
    `Reply:`,
    `1 - Accept`,
    `2 - Decline`,
    `3 - Decline, wrong time (suggest alternatives)`,
    `4 - Decline, need more information`,
    ``,
    `This request expires ${when(p.expiresAt)}.`,
  ].join('\n');
}

export interface CardReminderPayload {
  refCode: string;
  sessionStart: string;
  payoutNet: string;
  currency: string;
  expiresAt: string;
}

export function CARD_REMINDER(p: CardReminderPayload): string {
  return [
    `Reminder: request #${p.refCode} is still waiting.`,
    `Session ${when(p.sessionStart)}, you earn ${money({ amount: p.payoutNet, currency: p.currency })}.`,
    `It expires ${when(p.expiresAt)}. Reply 1 to accept or 2 to decline.`,
  ].join('\n');
}

export interface AcceptedProfessionalPayload {
  refCode: string;
  sessionStart: string;
  payoutNet: string;
  currency: string;
}

export function ACCEPTED_PROFESSIONAL(p: AcceptedProfessionalPayload): string {
  return [
    `Confirmed #${p.refCode}. Session ${when(p.sessionStart)}.`,
    `Payout of ${money({ amount: p.payoutNet, currency: p.currency })} is released after the session completes.`,
    `A WhatsApp consult room opens 15 minutes before the start.`,
  ].join('\n');
}

export interface CounterPromptPayload {
  refCode: string;
}

export function COUNTER_PROMPT(p: CounterPromptPayload): string {
  return [
    `No problem — suggest up to 3 alternative times for #${p.refCode}, one per line.`,
    `For example:`,
    `tomorrow 2pm`,
    `Friday 10:30`,
    `Sat 9am`,
  ].join('\n');
}

export interface CounterConfirmEchoPayload {
  refCode: string;
  slots: { sessionStart: string; durationMinutes: number }[];
}

export function COUNTER_CONFIRM_ECHO(p: CounterConfirmEchoPayload): string {
  const lines = p.slots.map((s, i) => `${i + 1}. ${when(s.sessionStart)} (${s.durationMinutes} min)`);
  return [
    `You are proposing these times for #${p.refCode}:`,
    ...lines,
    ``,
    `Reply YES to send them to the client, or NO to start over.`,
  ].join('\n');
}

export interface NoShowNudgePayload {
  refCode: string;
  minutesLate: number;
}

export function NO_SHOW_NUDGE(p: NoShowNudgePayload): string {
  return `Session #${p.refCode} started ${p.minutesLate} minutes ago and you haven't joined the room yet. Please join now — at 15 minutes the session is marked a no-show and refunded.`;
}

export interface PayoutConfirmedPayload {
  refCode: string;
  payoutNet: string;
  currency: string;
}

export function PAYOUT_CONFIRMED(p: PayoutConfirmedPayload): string {
  return `Session #${p.refCode} complete. Your payout of ${money({ amount: p.payoutNet, currency: p.currency })} is on its way.`;
}

// ---------- room-facing (a consult room exists) ----------

export interface RoomWelcomePayload {
  refCode: string;
  professionalName: string;
  clientName: string;
  sessionStart: string;
  durationMinutes: number;
}

export function ROOM_WELCOME(p: RoomWelcomePayload): string {
  return [
    `Welcome to your consult room for #${p.refCode}.`,
    `${p.clientName}, meet ${p.professionalName}.`,
    `The session runs ${when(p.sessionStart)} for ${p.durationMinutes} minutes.`,
    `This room dissolves 30 minutes after the session ends.`,
  ].join('\n');
}

export interface SessionEndWarningPayload {
  refCode: string;
  minutesLeft: number;
}

export function SESSION_END_WARNING(p: SessionEndWarningPayload): string {
  return `Heads up: ${p.minutesLeft} minutes left in session #${p.refCode}.`;
}

// ---------- client-facing ----------

export interface AcceptedClientPayload {
  refCode: string;
  sessionStart: string;
  priceGross: string;
  currency: string;
}

export function ACCEPTED_CLIENT(p: AcceptedClientPayload): string {
  return [
    `Your session ${p.refCode} is confirmed for ${when(p.sessionStart)}.`,
    `Paid: ${money({ amount: p.priceGross, currency: p.currency })} (held in escrow until the session completes).`,
    `A WhatsApp consult room opens 15 minutes before the start.`,
  ].join('\n');
}

export interface DeclinedClientPayload {
  refCode: string;
}

export function DECLINED_CLIENT(p: DeclinedClientPayload): string {
  return `Unfortunately the professional can't take session ${p.refCode}. Your full payment is being refunded — it usually lands within 2 business days.`;
}

export interface ExpiredClientPayload {
  refCode: string;
}

export function EXPIRED_CLIENT(p: ExpiredClientPayload): string {
  return `The professional didn't respond to request ${p.refCode} in time. Your full payment is being refunded — it usually lands within 2 business days.`;
}

export interface CounterSentClientPayload {
  refCode: string;
}

export function COUNTER_SENT_CLIENT(p: CounterSentClientPayload): string {
  return `The professional can't make your requested time for ${p.refCode} but has proposed alternatives. Open the app to pick one — the offer stays valid for 12 hours.`;
}

export interface PartialRefundClientPayload {
  refCode: string;
  amount: string;
  currency: string;
}

export function PARTIAL_REFUND_CLIENT(p: PartialRefundClientPayload): string {
  return `Good news: the new time you picked for ${p.refCode} falls in a cheaper rate. We're refunding the ${money({ amount: p.amount, currency: p.currency })} difference.`;
}

export interface NoShowClientRefundPayload {
  refCode: string;
  amount: string;
  currency: string;
}

export function NO_SHOW_CLIENT_REFUND(p: NoShowClientRefundPayload): string {
  return `The professional didn't show up for session ${p.refCode}. We're sorry — your full payment of ${money({ amount: p.amount, currency: p.currency })} is being refunded.`;
}

export interface RebookPromptPayload {
  refCode: string;
}

export function REBOOK_PROMPT(p: RebookPromptPayload): string {
  return `Hope your session ${p.refCode} went well! You can book the same professional again any time from the app.`;
}

// ---------- conversational glue (professional-facing) ----------

export interface WhichRequestPayload {
  refCodes: string[];
}

export function WHICH_REQUEST(p: WhichRequestPayload): string {
  return [
    `You have ${p.refCodes.length} pending requests. Which one do you mean?`,
    ...p.refCodes.map((r) => `Reply 1 for #${r} — or include the code, e.g. "#${r} 1"`),
  ].join('\n');
}

export interface RepromptPayload {
  refCode: string;
  hint: string;
}

export function REPROMPT(p: RepromptPayload): string {
  return `Sorry, I didn't catch that for #${p.refCode}. ${p.hint}`;
}

export interface StatusSummaryPayload {
  refCode: string;
  state: string;
  moneyLine: string;
}

export function STATUS_SUMMARY(p: StatusSummaryPayload): string {
  return `Request #${p.refCode} is ${p.state.replace(/_/g, ' ').toLowerCase()}. ${p.moneyLine}`;
}

// ---------- professional verification (phase 7) ----------

export interface VerificationOtpPayload {
  code: string;
}

export function VERIFICATION_OTP(p: VerificationOtpPayload): string {
  return `Your verification code is ${p.code}. Enter it on the registration page to confirm this WhatsApp number. It expires in 10 minutes.`;
}

export interface VerificationApprovedPayload {
  displayName: string;
}

export function VERIFICATION_APPROVED(p: VerificationApprovedPayload): string {
  return `Welcome aboard, ${p.displayName}! Your registration is verified — you can now receive session requests on this number. Requests arrive as cards you answer by replying 1 (accept) or 2 (decline).`;
}

export interface VerificationRejectedPayload {
  registry: string;
  attemptsLeft: number;
}

export function VERIFICATION_REJECTED(p: VerificationRejectedPayload): string {
  const retry =
    p.attemptsLeft > 0
      ? `Please check your registration number and the exact name on your ${p.registry} record, then resubmit — you have ${p.attemptsLeft} ${p.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`
      : `You have used all resubmission attempts. Contact support to continue.`;
  return `We couldn't verify your registration with ${p.registry}. ${retry}`;
}

export function VERIFICATION_IN_REVIEW(): string {
  return `We're confirming your registration with the registry — this usually takes about 1 business day. We'll message you here as soon as it's done.`;
}

// ---------- paid direct messages (spam gate) ----------

export interface DirectMessagePayload {
  clientName: string;
  body: string;
  feeLine: string; // e.g. "KES 50.00 paid"
  /** Professional's own note appended to forwarded messages, set in the portal. */
  note?: string;
}

export function DIRECT_MESSAGE(p: DirectMessagePayload): string {
  const lines = [`📩 Paid message from ${p.clientName} (${p.feeLine}):`, '', `"${p.body}"`];
  if (p.note) lines.push('', p.note);
  return lines.join('\n');
}

// ---------- registry ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
export const TEMPLATES: Record<string, (payload: any) => string> = {
  REQUEST_CARD,
  CARD_REMINDER,
  ACCEPTED_PROFESSIONAL,
  ACCEPTED_CLIENT,
  DECLINED_CLIENT,
  EXPIRED_CLIENT,
  COUNTER_PROMPT,
  COUNTER_CONFIRM_ECHO,
  COUNTER_SENT_CLIENT,
  PARTIAL_REFUND_CLIENT,
  ROOM_WELCOME,
  NO_SHOW_NUDGE,
  NO_SHOW_CLIENT_REFUND,
  SESSION_END_WARNING,
  PAYOUT_CONFIRMED,
  REBOOK_PROMPT,
  WHICH_REQUEST,
  REPROMPT,
  STATUS_SUMMARY,
  VERIFICATION_OTP,
  VERIFICATION_APPROVED,
  VERIFICATION_REJECTED,
  VERIFICATION_IN_REVIEW,
  DIRECT_MESSAGE,
};

// TemplateRenderer for the outbox dispatcher.
export function renderTemplate(templateKey: string, payload: Record<string, unknown>): string {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown template key: ${templateKey}`);
  return template(payload);
}
