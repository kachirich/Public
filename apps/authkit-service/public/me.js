const nameEl = document.getElementById('user-name');
const emailEl = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');

async function loadMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) {
    window.location.href = '/login.html';
    return;
  }
  const data = await res.json();
  nameEl.textContent = data.user.name || 'there';
  emailEl.textContent = data.user.email;
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
});

loadMe();
