document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['studies', 'flagged', 'businesses', 'users', 'withdrawals', 'ledger'].forEach(t =>
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== name));
  const loaders = { studies: loadStudies, flagged: loadFlagged, businesses: loadBusinesses, users: loadUsers, withdrawals: loadWithdrawals, ledger: loadLedger };
  loaders[name]();
}

async function init() {
  const user = await requireRole('ADMIN');
  if (!user) return;
  document.getElementById('userName').textContent = user.full_name || user.email;
  loadStats();
  loadStudies();
}

async function loadStats() {
  try {
    const s = await api('GET', '/api/admin/stats');
    document.getElementById('statsBar').innerHTML = `
      <div class="card"><h3>${s.activeStudies}</h3><span class="muted">Active studies</span></div>
      <div class="card"><h3>${s.pendingApproval}</h3><span class="muted">Pending approval</span></div>
      <div class="card"><h3>${s.flaggedResponses}</h3><span class="muted">Flagged responses</span></div>
      <div class="card"><h3>${paise(s.totalRewardsPaidPaise)}</h3><span class="muted">Rewards confirmed</span></div>
    `;
  } catch (err) { showAlert('alert', err.message); }
}

async function loadStudies() {
  clearAlert('alert');
  try {
    const studies = await api('GET', '/api/admin/studies');
    document.getElementById('studiesList').innerHTML = studies.map(s => `
      <div class="card">
        <div class="row"><h3 style="flex:1;">${escapeHtml(s.title)}</h3>${badge(s.status)}</div>
        <p class="muted">${escapeHtml(s.target_city)} · ${s.sample_size} respondents · template: ${s.template_type}</p>
        ${s.status === 'SUBMITTED' || s.status === 'ADMIN_REVIEW' ? `
          <div class="row">
            <button onclick="approveStudy('${s.id}')">Approve & Activate</button>
            <button class="danger" onclick="rejectStudy('${s.id}')">Reject</button>
          </div>` : ''}
        ${s.status === 'ACTIVE' ? `
          <div class="row">
            <button class="secondary" onclick="lifecycleAction('${s.id}', 'pause')">Pause</button>
            <button class="secondary" onclick="lifecycleAction('${s.id}', 'complete')">Mark complete</button>
            <button class="danger" onclick="lifecycleAction('${s.id}', 'cancel')">Cancel</button>
          </div>` : ''}
        ${s.status === 'PAUSED' ? `
          <div class="row">
            <button onclick="lifecycleAction('${s.id}', 'resume')">Resume</button>
            <button class="danger" onclick="lifecycleAction('${s.id}', 'cancel')">Cancel</button>
          </div>` : ''}
      </div>
    `).join('') || '<p class="muted">No studies yet.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function approveStudy(id) {
  try { await api('POST', `/api/admin/studies/${id}/approve`); loadStudies(); loadStats(); }
  catch (err) { showAlert('alert', err.message); }
}
async function rejectStudy(id) {
  const reason = prompt('Reason for rejection?') || 'Not specified';
  try { await api('POST', `/api/admin/studies/${id}/reject`, { reason }); loadStudies(); }
  catch (err) { showAlert('alert', err.message); }
}

async function lifecycleAction(id, action) {
  const reason = (action === 'pause' || action === 'cancel') ? (prompt('Reason (optional)?') || null) : null;
  try {
    await api('POST', `/api/admin/studies/${id}/${action}`, { reason });
    loadStudies();
    loadStats();
  } catch (err) { showAlert('alert', err.message); }
}

async function loadFlagged() {
  clearAlert('alert');
  try {
    const list = await api('GET', '/api/admin/responses/flagged');
    document.getElementById('flaggedList').innerHTML = list.length ? list.map(r => `
      <div class="card">
        <h3>${escapeHtml(r.study_title)}</h3>
        <p class="muted">Response ID: ${r.id} · Duration: ${r.duration_seconds}s · Quality score: ${r.quality_score}</p>
        <p><strong>Flag reasons:</strong> ${JSON.parse(r.flag_reasons).join('; ')}</p>
        <div class="row">
          <button onclick="reviewResponse('${r.id}', 'VALID')">Approve as valid</button>
          <button class="danger" onclick="reviewResponse('${r.id}', 'REJECTED')">Reject response</button>
        </div>
      </div>
    `).join('') : '<p class="muted">No flagged responses awaiting review.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function reviewResponse(id, decision) {
  const notes = prompt(`Notes for this ${decision} decision (optional):`) || '';
  try { await api('POST', `/api/admin/responses/${id}/review`, { decision, notes }); loadFlagged(); loadStats(); }
  catch (err) { showAlert('alert', err.message); }
}

async function loadBusinesses() {
  clearAlert('alert');
  try {
    const list = await api('GET', '/api/admin/businesses');
    document.getElementById('businessList').innerHTML = list.map(b => `
      <div class="card">
        <div class="row"><h3 style="flex:1;">${escapeHtml(b.legal_name)}</h3>${badge(b.verification_status)}</div>
        <p class="muted">${escapeHtml(b.city || '')} · ${escapeHtml(b.category || '')} · GSTIN: ${escapeHtml(b.gstin || 'not provided')}</p>
        ${b.verification_status === 'PENDING' ? `
          <div class="row">
            <button onclick="verifyBusiness('${b.id}')">Verify</button>
            <button class="danger" onclick="rejectBusiness('${b.id}')">Reject</button>
          </div>` : ''}
      </div>
    `).join('');
  } catch (err) { showAlert('alert', err.message); }
}
async function verifyBusiness(id) { try { await api('POST', `/api/admin/businesses/${id}/verify`); loadBusinesses(); } catch (e) { showAlert('alert', e.message); } }
async function rejectBusiness(id) { try { await api('POST', `/api/admin/businesses/${id}/reject`, { reason: prompt('Reason?') }); loadBusinesses(); } catch (e) { showAlert('alert', e.message); } }

async function loadUsers() {
  clearAlert('alert');
  try {
    const list = await api('GET', '/api/admin/users');
    document.getElementById('usersList').innerHTML = `
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(u => `<tr>
        <td>${escapeHtml(u.full_name || '')}</td><td>${escapeHtml(u.email || u.phone || '')}</td><td>${u.role}</td><td>${badge(u.status)}</td>
        <td>${u.role !== 'SUPER_ADMIN' ? (u.status === 'ACTIVE'
          ? `<button class="danger" onclick="suspendUser('${u.id}')">Suspend</button>`
          : `<button class="secondary" onclick="reactivateUser('${u.id}')">Reactivate</button>`) : ''}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (err) { showAlert('alert', err.message); }
}
async function suspendUser(id) { try { await api('POST', `/api/admin/users/${id}/suspend`, { reason: prompt('Reason?') }); loadUsers(); } catch (e) { showAlert('alert', e.message); } }
async function reactivateUser(id) { try { await api('POST', `/api/admin/users/${id}/reactivate`); loadUsers(); } catch (e) { showAlert('alert', e.message); } }

async function loadWithdrawals() {
  clearAlert('alert');
  try {
    const list = await api('GET', '/api/admin/withdrawals');
    document.getElementById('withdrawalsList').innerHTML = `
      <table><thead><tr><th>User</th><th>Amount</th><th>UPI</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(w => `<tr>
        <td>${escapeHtml(w.full_name || w.email)}</td><td>${paise(w.amount_paise)}</td><td>${escapeHtml(w.upi_id)}</td><td>${badge(w.status)}</td>
        <td>${(w.status === 'REQUESTED' || w.status === 'PROCESSING') ? `
          <button onclick="markPaid('${w.id}')">Mark paid (manual)</button>
          <button class="danger" onclick="rejectW('${w.id}')">Reject</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>
      <p class="muted" style="margin-top:10px;">"Mark paid" only records that you sent a real UPI payout manually outside this system — it does NOT move real money itself. See README.</p>`;
  } catch (err) { showAlert('alert', err.message); }
}
async function markPaid(id) { try { await api('POST', `/api/admin/withdrawals/${id}/mark-paid`); loadWithdrawals(); } catch (e) { showAlert('alert', e.message); } }
async function rejectW(id) { try { await api('POST', `/api/admin/withdrawals/${id}/reject`, { reason: prompt('Reason?') }); loadWithdrawals(); } catch (e) { showAlert('alert', e.message); } }

async function loadLedger() {
  clearAlert('alert');
  try {
    const { transactions, reconciliationIssues } = await api('GET', '/api/admin/ledger');
    let html = '';
    if (reconciliationIssues.length) {
      html += `<div class="alert error">Reconciliation mismatch detected for ${reconciliationIssues.length} wallet(s) — investigate immediately.</div>`;
    } else {
      html += `<div class="alert success">All wallet balances reconcile against the transaction ledger.</div>`;
    }
    html += `<table><thead><tr><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${transactions.map(t => `<tr><td>${escapeHtml(t.email || '')}</td><td>${t.type}</td><td>${paise(t.amount_paise)}</td><td>${badge(t.status)}</td><td>${new Date(t.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
    document.getElementById('ledgerArea').innerHTML = html;
  } catch (err) { showAlert('alert', err.message); }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
