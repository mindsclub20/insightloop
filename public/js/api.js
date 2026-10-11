async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function paise(p) {
  return '\u20B9' + (p / 100).toFixed(2);
}

function showAlert(elId, message, type = 'error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = 'alert ' + type;
  el.classList.remove('hidden');
}

function clearAlert(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('hidden');
}

function badge(status) {
  const map = {
    ACTIVE: 'green', VALID: 'green', CONFIRMED: 'green', VERIFIED: 'green', PAID: 'green',
    PENDING: 'amber', SUBMITTED: 'amber', REQUESTED: 'amber', PROCESSING: 'amber', DRAFT: 'gray',
    FLAGGED: 'amber', REJECTED: 'red', FAILED: 'red', SUSPENDED: 'red', ARCHIVED: 'gray',
    COMPLETED: 'green', ADMIN_REVIEW: 'amber', PAUSED: 'amber', CANCELLED: 'red', REPORT_READY: 'green',
  };
  const cls = map[status] || 'gray';
  return `<span class="badge ${cls}">${status}</span>`;
}

async function requireRole(role) {
  try {
    const { user } = await api('GET', '/api/auth/me');
    if (user.role !== role && !(role === 'ADMIN' && user.role === 'SUPER_ADMIN')) {
      window.location.href = '/login.html';
      return null;
    }
    return user;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

async function logout() {
  await api('POST', '/api/auth/logout');
  window.location.href = '/index.html';
}
