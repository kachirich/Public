import { postJSON, showMessage, hideMessage, setLoading, isPasswordStrong, getReturnToParam } from './app.js';

const form = document.getElementById('register-form');
const message = document.getElementById('message');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage(message);

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (!isPasswordStrong(password)) {
    showMessage(message, 'Password must be at least 8 characters and include a number and a special character.');
    return;
  }
  if (password !== confirmPassword) {
    showMessage(message, 'Passwords do not match.');
    return;
  }

  setLoading(submitBtn, true, 'Create account');
  try {
    const data = await postJSON('/api/auth/register', { email, password, name, returnTo: getReturnToParam() });
    window.location.href = data.redirectTo || '/me.html';
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    setLoading(submitBtn, false, 'Create account');
  }
});
