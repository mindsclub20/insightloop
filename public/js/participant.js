let CURRENT_USER = null;
let SURVEY_STATE = null; // { study, questions, index, answers, startedAt }

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['studies', 'wallet', 'withdraw', 'profile'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== name);
  });
  if (name === 'wallet') loadWallet();
  if (name === 'withdraw') loadWithdrawals();
  if (name === 'profile') loadProfile();
}

async function init() {
  CURRENT_USER = await requireRole('USER');
  if (!CURRENT_USER) return;
  document.getElementById('userName').textContent = CURRENT_USER.full_name || CURRENT_USER.email;
  loadStudies();
}

async function loadStudies() {
  clearAlert('alert');
  try {
    const studies = await api('GET', '/api/participant/studies');
    const list = document.getElementById('studyList');
    if (studies.length === 0) {
      list.innerHTML = '<p class="muted">No research opportunities match your profile right now. Check back soon.</p>';
      return;
    }
    list.innerHTML = studies.map(s => `
      <div class="card">
        <h3>${escapeHtml(s.title)}</h3>
        <p class="muted">${escapeHtml(s.objective || '')}</p>
        <div class="row">
          <span class="badge green">${paise(s.reward_paise)}</span>
          <span class="muted">~${s.estimated_minutes} min</span>
          <span class="muted">${escapeHtml(s.target_city)}</span>
        </div>
        <button style="margin-top:10px;" onclick="openStudy('${s.id}')">View & Start</button>
      </div>
    `).join('');
  } catch (err) {
    showAlert('alert', err.message);
  }
}

async function openStudy(id) {
  clearAlert('alert');
  try {
    const detail = await api('GET', `/api/participant/studies/${id}`);
    const el = document.getElementById('studyDetail');
    if (detail.alreadyResponded) {
      el.innerHTML = `<div class="card"><h3>${escapeHtml(detail.study.title)}</h3>
        <p>You already responded to this study. Status: ${badge(detail.responseStatus)}</p>
        <button class="ghost" onclick="document.getElementById('studyDetail').innerHTML=''">Close</button></div>`;
      return;
    }
    if (!detail.eligibility.eligible) {
      el.innerHTML = `<div class="card"><h3>${escapeHtml(detail.study.title)}</h3>
        <p class="alert error">Not eligible: ${escapeHtml(detail.eligibility.reason)}</p>
        <button class="ghost" onclick="document.getElementById('studyDetail').innerHTML=''">Close</button></div>`;
      return;
    }
    SURVEY_STATE = { study: detail.study, questions: detail.questions, index: 0, answers: {}, startedAt: Date.now() };
    renderSurveyQuestion();
  } catch (err) {
    showAlert('alert', err.message);
  }
}

function renderSurveyQuestion() {
  const { study, questions, index } = SURVEY_STATE;
  const el = document.getElementById('studyDetail');
  const pct = Math.round((index / questions.length) * 100);

  if (index >= questions.length) {
    el.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(study.title)} - Review & Submit</h3>
        <p class="muted">You've answered all ${questions.length} questions. Submit to complete this study.</p>
        <button onclick="submitSurvey()">Submit responses</button>
        <button class="ghost" onclick="document.getElementById('studyDetail').innerHTML=''; SURVEY_STATE=null;">Cancel</button>
      </div>`;
    return;
  }

  const q = questions[index];
  let inputHtml = '';
  if (q.question_type === 'single_choice' || q.question_type === 'yes_no') {
    inputHtml = q.options.map(o => `
      <label style="font-weight:400; display:flex; gap:8px; align-items:center; padding:8px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; cursor:pointer;">
        <input type="radio" name="opt" value="${o.id}" style="width:auto;"> ${escapeHtml(o.option_text)}
      </label>`).join('');
  } else if (q.question_type === 'multi_choice') {
    inputHtml = q.options.map(o => `
      <label style="font-weight:400; display:flex; gap:8px; align-items:center; padding:8px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; cursor:pointer;">
        <input type="checkbox" name="opt" value="${o.id}" style="width:auto;"> ${escapeHtml(o.option_text)}
      </label>`).join('');
  } else if (q.question_type === 'rating_5' || q.question_type === 'rating_10') {
    const max = q.question_type === 'rating_5' ? 5 : 10;
    inputHtml = `<div class="row">${Array.from({length: max}, (_, i) => i + 1).map(n =>
      `<button type="button" class="secondary" style="min-width:40px;" onclick="selectRating(${n})" id="rate-${n}">${n}</button>`).join('')}</div>`;
  } else {
    inputHtml = q.question_type === 'long_text'
      ? `<textarea id="textAns" placeholder="Type your answer..."></textarea>`
      : `<input id="textAns" placeholder="Type your answer...">`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <p class="muted">Question ${index + 1} of ${questions.length}</p>
      <h3>${escapeHtml(q.question_text)}</h3>
      ${inputHtml}
      <div class="row" style="margin-top:14px;">
        <button class="ghost" onclick="prevQuestion()" ${index === 0 ? 'disabled' : ''}>Back</button>
        <span class="spacer"></span>
        <button onclick="nextQuestion()">Next</button>
      </div>
    </div>`;

  // pre-fill from saved answer if navigating back
  const saved = SURVEY_STATE.answers[q.id];
  if (saved) {
    if (saved.rating_value) selectRating(saved.rating_value);
    if (saved.text_answer) document.getElementById('textAns') && (document.getElementById('textAns').value = saved.text_answer);
    if (saved.selected_option_ids) {
      saved.selected_option_ids.forEach(id => {
        const inp = document.querySelector(`input[value="${id}"]`);
        if (inp) inp.checked = true;
      });
    }
  }
}

let _selectedRating = null;
function selectRating(n) {
  _selectedRating = n;
  document.querySelectorAll('[id^="rate-"]').forEach(b => b.classList.remove('active-rating'));
  const btn = document.getElementById('rate-' + n);
  if (btn) { btn.style.background = 'var(--primary)'; btn.style.color = '#fff'; }
}

function nextQuestion() {
  const q = SURVEY_STATE.questions[SURVEY_STATE.index];
  let answer = { question_id: q.id };

  if (q.question_type === 'single_choice' || q.question_type === 'yes_no') {
    const checked = document.querySelector('input[name="opt"]:checked');
    if (q.is_required && !checked) { alert('Please select an option'); return; }
    answer.selected_option_ids = checked ? [checked.value] : [];
  } else if (q.question_type === 'multi_choice') {
    const checked = Array.from(document.querySelectorAll('input[name="opt"]:checked')).map(i => i.value);
    if (q.is_required && checked.length === 0) { alert('Please select at least one option'); return; }
    answer.selected_option_ids = checked;
  } else if (q.question_type === 'rating_5' || q.question_type === 'rating_10') {
    if (q.is_required && !_selectedRating) { alert('Please select a rating'); return; }
    answer.rating_value = _selectedRating;
  } else {
    const val = document.getElementById('textAns').value.trim();
    if (q.is_required && !val) { alert('Please type an answer'); return; }
    answer.text_answer = val;
  }

  SURVEY_STATE.answers[q.id] = answer;
  _selectedRating = null;
  SURVEY_STATE.index += 1;
  renderSurveyQuestion();
}

function prevQuestion() {
  _selectedRating = null;
  SURVEY_STATE.index = Math.max(0, SURVEY_STATE.index - 1);
  renderSurveyQuestion();
}

function getDeviceFingerprint() {
  // Simple, non-invasive client signature (not true device fingerprinting) -
  // good enough for P0 duplicate-device heuristics, stored per-browser.
  let fp = localStorage.getItem('il_device_fp');
  if (!fp) {
    fp = 'fp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('il_device_fp', fp);
  }
  return fp;
}

async function submitSurvey() {
  const durationSeconds = Math.round((Date.now() - SURVEY_STATE.startedAt) / 1000);
  const answers = Object.values(SURVEY_STATE.answers);
  try {
    const result = await api('POST', `/api/participant/studies/${SURVEY_STATE.study.id}/submit`, {
      answers, duration_seconds: durationSeconds, device_fingerprint: getDeviceFingerprint(),
    });
    document.getElementById('studyDetail').innerHTML = `
      <div class="card">
        <h3>Thanks for participating!</h3>
        <p class="alert ${result.status === 'FLAGGED' ? 'info' : 'success'}">${escapeHtml(result.message)}</p>
        <button class="ghost" onclick="document.getElementById('studyDetail').innerHTML=''; loadStudies();">Back to studies</button>
      </div>`;
    SURVEY_STATE = null;
  } catch (err) {
    showAlert('alert', err.message);
  }
}

async function loadWallet() {
  try {
    const wallet = await api('GET', '/api/participant/wallet');
    document.getElementById('balanceAmt').textContent = paise(wallet.balance_paise);
    document.getElementById('pendingAmt').textContent = paise(wallet.pending_paise);
    const txs = await api('GET', '/api/participant/transactions');
    document.getElementById('txList').innerHTML = txs.length ? `
      <table><thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${txs.map(t => `<tr><td>${t.type}</td><td>${paise(t.amount_paise)}</td><td>${badge(t.status)}</td><td>${new Date(t.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>
    ` : '<p class="muted">No transactions yet.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function loadWithdrawals() {
  try {
    const list = await api('GET', '/api/participant/withdrawals');
    document.getElementById('withdrawalList').innerHTML = list.length ? `
      <table><thead><tr><th>Amount</th><th>UPI</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${list.map(w => `<tr><td>${paise(w.amount_paise)}</td><td>${escapeHtml(w.upi_id)}</td><td>${badge(w.status)}</td><td>${new Date(w.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>
    ` : '<p class="muted">No withdrawal requests yet.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function submitWithdrawal() {
  clearAlert('alert');
  const amount = Math.round(parseFloat(document.getElementById('wAmount').value) * 100);
  const upi = document.getElementById('wUpi').value.trim();
  try {
    await api('POST', '/api/participant/withdrawals', { amount_paise: amount, upi_id: upi });
    showAlert('alert', 'Withdrawal requested — an admin will process it manually.', 'success');
    loadWithdrawals();
    loadWallet();
  } catch (err) { showAlert('alert', err.message); }
}

async function loadProfile() {
  try {
    const { profile, tags } = await api('GET', '/api/participant/profile');
    document.getElementById('pCity').value = profile?.city || '';
    document.getElementById('pArea').value = profile?.area || '';
    document.getElementById('pAge').value = profile?.age_range || '18-25';
    document.getElementById('pInterests').value = (tags || []).join(', ');
  } catch (err) { showAlert('alert', err.message); }
}

async function saveProfile() {
  clearAlert('alert');
  try {
    await api('PATCH', '/api/participant/profile', {
      city: document.getElementById('pCity').value,
      area: document.getElementById('pArea').value,
      age_range: document.getElementById('pAge').value,
      interests: document.getElementById('pInterests').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    });
    showAlert('alert', 'Profile updated.', 'success');
  } catch (err) { showAlert('alert', err.message); }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
