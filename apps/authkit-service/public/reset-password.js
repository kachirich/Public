import { postJSON, showMessage, hideMessage, setLoading, isPasswordStrong } from './app.js';

const form = document.getElementById('reset-form');
const message = document.getElementById('message');
const submitBtn = document.getElementById('submit-btn');

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const email = params.get('email');

if (!token || !email) {
  showMessage(message, 'This reset link is missing required information. Please request a new one.');
  form.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage(message);

  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (!isPasswordStrong(newPassword)) {
    showMessage(message, 'Password must be at least 8 characters and include a number and a special character.');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage(message, 'Passwords do not match.');
    return;
  }

  setLoading(submitBtn, true, 'Reset password');
  try {
    const data = await postJSON('/api/auth/reset-password', { email, token, newPassword });
    showMessage(message, data.message || 'Password reset successfully.', 'success');
    form.reset();
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 1500);
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    setLoading(submitBtn, false, 'Reset password');
  }
});
