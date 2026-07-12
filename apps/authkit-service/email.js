import { Resend } from 'resend';

let resendClient = null;
function client() {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const from = process.env.EMAIL_FROM || 'Professional Access AuthKit <security@example.com>';
  const text = `We received a request to reset your password. Reset it here: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can safely ignore this email — your password will not change.`;

  try {
    const { data, error } = await client().emails.send({
      from,
      to,
      subject: 'Reset your password',
      text,
      html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can safely ignore this email — your password will not change.</p>`,
    });

    if (error) {
      console.error('[email] Resend API error:', error);
      return { success: false, error };
    }
    console.log('[email] Password reset email sent: %s', data?.id);
    return { success: true, data };
  } catch (err) {
    console.error('[email] Unexpected error sending password reset email:', err);
    return { success: false, error: err };
  }
}
