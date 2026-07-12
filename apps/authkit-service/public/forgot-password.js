import { postJSON, showMessage, hideMessage, setLoading } from './app.js';

const form = document.getElementById('forgot-form');
const message = document.getElementById('message');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage(message);
  setLoading(submitBtn, true, 'Send reset link');

  const email = document.getElementById('email').value.trim();

  try {
    const data = await postJSON('/api/auth/forgot-password', { email });
    showMessage(message, data.message || 'If an account exists with that email, a reset link has been sent.', 'success');
    form.reset();
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    setLoading(submitBtn, false, 'Send reset link');
  }
});
