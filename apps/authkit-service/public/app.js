// Shared helpers used by every page in this bundle.

export async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON response (shouldn't happen against this API)
  }
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export function showMessage(el, text, kind = 'error') {
  el.textContent = text;
  el.classList.remove('error', 'success');
  el.classList.add(kind, 'visible');
}

export function hideMessage(el) {
  el.classList.remove('visible');
}

export function setLoading(button, loading, label) {
  button.disabled = loading;
  button.textContent = loading ? 'Please wait…' : label;
}

export function isPasswordStrong(password) {
  return /^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/.test(password);
}
