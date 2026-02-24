// static/js/landing-auth.js
// Simple landing-page auth (login/register) + status messaging.

function qs(sel) {
  return document.querySelector(sel);
}

function setActiveTab(which) {
  const tabLogin = qs('#tabLogin');
  const tabRegister = qs('#tabRegister');
  const panelLogin = qs('#panelLogin');
  const panelRegister = qs('#panelRegister');
  if (!tabLogin || !tabRegister || !panelLogin || !panelRegister) return;

  const isLogin = which === 'login';

  tabLogin.classList.toggle('is-active', isLogin);
  tabRegister.classList.toggle('is-active', !isLogin);
  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabRegister.setAttribute('aria-selected', String(!isLogin));

  panelLogin.classList.toggle('is-active', isLogin);
  panelRegister.classList.toggle('is-active', !isLogin);
}

function showStatus(msg, kind = 'info') {
  const el = qs('#authStatus');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.color = kind === 'error' ? 'var(--danger, #8a2d2d)' : 'var(--ink-1)';
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error || `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data;
}

async function doLogin() {
  const email = (qs('#loginEmail')?.value || '').trim();
  const password = (qs('#loginPassword')?.value || '');
  try {
    showStatus('Signing you in…');
    await postJSON('/api/login', { email, password });
    showStatus('Signed in. Redirecting…');
    window.location.href = '/tree';
  } catch (e) {
    showStatus(e.message || 'Login failed.', 'error');
  }
}

async function doRegister() {
  const email = (qs('#regEmail')?.value || '').trim();
  const password = (qs('#regPassword')?.value || '');
  try {
    showStatus('Creating your account…');
    await postJSON('/api/register', { email, password });
    showStatus('Account created. Redirecting…');
    window.location.href = '/tree';
  } catch (e) {
    showStatus(e.message || 'Registration failed.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  qs('#tabLogin')?.addEventListener('click', () => setActiveTab('login'));
  qs('#tabRegister')?.addEventListener('click', () => setActiveTab('register'));

  qs('#loginBtn')?.addEventListener('click', doLogin);
  qs('#registerBtn')?.addEventListener('click', doRegister);

  // Enter key submit
  qs('#loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  qs('#regPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doRegister();
  });
});
