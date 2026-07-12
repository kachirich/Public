import { postJSON, showMessage, hideMessage, setLoading, getReturnToParam } from './app.js';

const form = document.getElementById('login-form');
const message = document.getElementById('message');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage(message);
  setLoading(submitBtn, true, 'Sign in');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const data = await postJSON('/api/auth/login', { email, password, returnTo: getReturnToParam() });
    window.location.href = data.redirectTo || '/me.html';
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    setLoading(submitBtn, false, 'Sign in');
  }
});
