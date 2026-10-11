let CURRENT_USER = null;
let DRAFT_STUDY = null;

const TEMPLATE_SUGGESTIONS = {
  pricing_test: [
    { question_text: 'Would you consider buying this at the stated price?', question_type: 'yes_no' },
    { question_text: 'What price would feel fair to you for this?', question_type: 'single_choice', options: ['Less than the stated price', 'About the stated price', 'I would pay more'] },
    { question_text: 'How likely are you to purchase this in the next month?', question_type: 'rating_5' },
    { question_text: 'What would make you more likely to buy?', question_type: 'short_text' },
  ],
  feature_preference: [
    { question_text: 'Which feature matters most to you?', question_type: 'single_choice', options: ['Price', 'Quality', 'Speed/Convenience', 'Variety'] },
    { question_text: 'How satisfied are you with current options in the market?', question_type: 'rating_5' },
    { question_text: 'What is missing from what is currently available?', question_type: 'long_text' },
  ],
  purchase_intent: [
    { question_text: 'Have you purchased something like this in the last 3 months?', question_type: 'yes_no' },
    { question_text: 'How likely are you to purchase this?', question_type: 'rating_10' },
    { question_text: 'What is the main reason for your answer?', question_type: 'short_text' },
  ],
  satisfaction: [
    { question_text: 'How satisfied are you with [business/product]?', question_type: 'rating_5' },
    { question_text: 'What do you like most?', question_type: 'short_text' },
    { question_text: 'What should be improved?', question_type: 'long_text' },
  ],
  timing_location: [
    { question_text: 'What time of day would you most likely visit/use this?', question_type: 'single_choice', options: ['Morning', 'Afternoon', 'Evening', 'Late night'] },
    { question_text: 'How far are you willing to travel for this?', question_type: 'single_choice', options: ['Walking distance', 'Short drive (<15 min)', 'Anywhere in the city'] },
  ],
  custom: [],
};

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('tab-create').classList.toggle('hidden', name !== 'create');
  document.getElementById('tab-studies').classList.toggle('hidden', name !== 'studies');
  if (name === 'studies') loadStudies();
}

async function init() {
  CURRENT_USER = await requireRole('BUSINESS');
  if (!CURRENT_USER) return;
  document.getElementById('userName').textContent = CURRENT_USER.full_name || CURRENT_USER.email;
  const biz = await api('GET', '/api/business/mine');
  renderVerificationBanner(biz);
  ['sample_size', 'reward'].forEach(id => document.getElementById(id).addEventListener('input', updateBudgetPreview));
  updateBudgetPreview();
}

function renderVerificationBanner(biz) {
  const el = document.getElementById('verificationBanner');
  if (biz.verification_status === 'VERIFIED') {
    el.innerHTML = '';
  } else if (biz.verification_status === 'PENDING') {
    el.innerHTML = `<div class="alert info">Your business is pending admin verification. You can build a draft study now, but it cannot be submitted for approval until verified.</div>`;
  } else {
    el.innerHTML = `<div class="alert error">Your business verification was rejected. Contact support.</div>`;
  }
}

function updateBudgetPreview() {
  const sample = parseInt(document.getElementById('sample_size').value, 10);
  const reward = Math.round(parseFloat(document.getElementById('reward').value || 0) * 100);
  const fee = Math.round(sample * reward * 0.3);
  const budget = sample * reward + fee;
  document.getElementById('budgetPreview').textContent = `Estimated budget: ${paise(budget)} (${paise(reward)}/response × ${sample} + platform fee)`;
}

async function createStudy() {
  clearAlert('alert');
  try {
    const study = await api('POST', '/api/business/studies', {
      template_type: document.getElementById('template_type').value,
      title: document.getElementById('title').value,
      objective: document.getElementById('objective').value,
      target_city: document.getElementById('target_city').value,
      target_min_age: parseInt(document.getElementById('min_age').value, 10),
      target_max_age: parseInt(document.getElementById('max_age').value, 10),
      target_gender: document.getElementById('target_gender').value,
      target_tags: document.getElementById('target_tags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      sample_size: parseInt(document.getElementById('sample_size').value, 10),
      reward_per_response_paise: Math.round(parseFloat(document.getElementById('reward').value) * 100),
    });
    DRAFT_STUDY = study;
    renderDraftBuilder();
  } catch (err) { showAlert('alert', err.message); }
}

function renderDraftBuilder() {
  const suggestions = TEMPLATE_SUGGESTIONS[DRAFT_STUDY.template_type] || [];
  const el = document.getElementById('draftBuilder');
  el.innerHTML = `
    <div class="card">
      <h3>Draft created: ${escapeHtml(DRAFT_STUDY.title)}</h3>
      <p class="muted">Suggested questions for this template (edit or add your own below, then submit for admin approval). Max 8 questions.</p>
      <div id="suggestedQuestions">
        ${suggestions.map((q, i) => `
          <div class="row" style="border:1px solid var(--border); padding:8px; border-radius:8px; margin-bottom:6px;">
            <span style="flex:1;">${escapeHtml(q.question_text)} <span class="muted">(${q.question_type})</span></span>
            <button class="secondary" onclick='addSuggested(${i})' data-idx="${i}">Add</button>
          </div>`).join('')}
      </div>
      <h3 style="margin-top:16px;">Add a custom question</h3>
      <label>Question text</label>
      <input id="qText">
      <label>Type</label>
      <select id="qType">
        <option value="single_choice">Single choice</option>
        <option value="multi_choice">Multiple choice</option>
        <option value="yes_no">Yes / No</option>
        <option value="rating_5">Rating (1-5)</option>
        <option value="rating_10">Rating (1-10)</option>
        <option value="short_text">Short text</option>
        <option value="long_text">Long text</option>
      </select>
      <label>Options (comma-separated, for choice questions)</label>
      <input id="qOptions" placeholder="Option A, Option B, Option C">
      <button class="secondary" style="margin-top:8px;" onclick="addCustomQuestion()">Add question</button>

      <h3 style="margin-top:16px;">Questions added so far</h3>
      <div id="addedQuestions"><p class="muted">None yet.</p></div>

      <button style="margin-top:16px;" onclick="submitForApproval()">Submit study for admin approval</button>
    </div>`;
  window._suggestions = suggestions;
  refreshAddedQuestions();
}

async function refreshAddedQuestions() {
  const study = await api('GET', `/api/business/studies/${DRAFT_STUDY.id}`);
  const list = study.questions;
  document.getElementById('addedQuestions').innerHTML = list.length
    ? list.map(q => `<div class="row"><span style="flex:1;">${q.order_index + 1}. ${escapeHtml(q.question_text)} <span class="muted">(${q.question_type})</span></span></div>`).join('')
    : '<p class="muted">None yet.</p>';
}

async function addSuggested(idx) {
  const q = window._suggestions[idx];
  try {
    await api('POST', `/api/business/studies/${DRAFT_STUDY.id}/questions`, {
      question_text: q.question_text, question_type: q.question_type, options: q.options || null,
    });
    refreshAddedQuestions();
  } catch (err) { showAlert('alert', err.message); }
}

async function addCustomQuestion() {
  clearAlert('alert');
  const text = document.getElementById('qText').value.trim();
  const type = document.getElementById('qType').value;
  const optsRaw = document.getElementById('qOptions').value.trim();
  const options = optsRaw ? optsRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!text) { showAlert('alert', 'Question text is required'); return; }
  try {
    await api('POST', `/api/business/studies/${DRAFT_STUDY.id}/questions`, { question_text: text, question_type: type, options });
    document.getElementById('qText').value = '';
    document.getElementById('qOptions').value = '';
    refreshAddedQuestions();
  } catch (err) { showAlert('alert', err.message); }
}

async function submitForApproval() {
  clearAlert('alert');
  try {
    const result = await api('POST', `/api/business/studies/${DRAFT_STUDY.id}/submit`, {});
    document.getElementById('draftBuilder').innerHTML = `<div class="alert success">Study submitted for admin approval. Payment status: ${result.paymentStatus} (P0: manual payment confirmation, see demo notice).</div>`;
    DRAFT_STUDY = null;
    switchTab('studies');
  } catch (err) { showAlert('alert', err.message); }
}

async function loadStudies() {
  clearAlert('alert');
  try {
    const studies = await api('GET', '/api/business/studies');
    document.getElementById('studyList').innerHTML = studies.length ? studies.map(s => `
      <div class="card">
        <div class="row">
          <h3 style="flex:1;">${escapeHtml(s.title)}</h3>
          ${badge(s.status)}
        </div>
        <p class="muted">${escapeHtml(s.target_city)} · ${s.sample_size} respondents · ${paise(s.reward_per_response_paise)}/response</p>
        <div class="row">
          <button class="secondary" onclick="viewStudy('${s.id}')">View details${s.status === 'ACTIVE' || s.status === 'COMPLETED' || s.status === 'REPORT_READY' ? ' & report' : ''}</button>
          ${['DRAFT', 'SUBMITTED'].includes(s.status) ? `<button class="danger" onclick="cancelStudy('${s.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `).join('') : '<p class="muted">No studies yet — create one from the "Create Research" tab.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function cancelStudy(id) {
  if (!confirm('Cancel this study? This cannot be undone.')) return;
  try { await api('POST', `/api/business/studies/${id}/cancel`, {}); loadStudies(); }
  catch (err) { showAlert('alert', err.message); }
}

async function viewStudy(id) {
  clearAlert('alert');
  try {
    const { study, questions, responseCounts } = await api('GET', `/api/business/studies/${id}`);
    let html = `<div class="card">
      <h3>${escapeHtml(study.title)} ${badge(study.status)}</h3>
      <p class="muted">${study.sample_size} target respondents · ${paise(study.reward_per_response_paise)}/response</p>
      <p><strong>Responses:</strong> ${responseCounts.map(r => `${r.status}: ${r.c}`).join(' · ') || 'None yet'}</p>`;
    if (study.status === 'REJECTED') html += `<p class="alert error">Rejected: ${escapeHtml(study.rejection_reason || '')}</p>`;
    if (study.status === 'ACTIVE' || study.status === 'COMPLETED') {
      html += `<button onclick="viewReport('${study.id}')">View insights report</button>`;
    }
    html += `<div id="reportArea" style="margin-top:14px;"></div></div>`;
    document.getElementById('studyDetail').innerHTML = html;
  } catch (err) { showAlert('alert', err.message); }
}

async function viewReport(id) {
  try {
    const report = await api('GET', `/api/business/studies/${id}/report`);
    const qHtml = report.questionAnalytics.map(q => {
      if (q.breakdown) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3>
          <table><tbody>${q.breakdown.map(b => `<tr><td>${escapeHtml(b.option)}</td><td>${b.count}</td><td>${b.percent ?? b.percentOfRespondents}%</td></tr>`).join('')}</tbody></table></div>`;
      }
      if (q.average !== undefined) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3><p>Average rating: <strong>${q.average ?? 'N/A'}</strong> (${q.responseCount} responses)</p></div>`;
      }
      return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3>
        <p class="muted">Top themes: ${(q.topThemes || []).map(t => t.word).join(', ') || 'Not enough data'}</p></div>`;
    }).join('');

    document.getElementById('reportArea').innerHTML = `
      <h3>Observed Results</h3>
      <p>Total responses: ${report.observedResults.totalResponses} · Valid: ${report.observedResults.validResponses} · Flagged/Rejected: ${report.observedResults.flaggedOrRejected}</p>
      <h3>Calculated Statistics</h3>
      <p>Completion rate: ${report.calculatedStatistics.completionRatePercent}% · Valid response rate: ${report.calculatedStatistics.validResponseRatePercent}%</p>
      <h3>Question Analytics (Observed)</h3>
      ${qHtml}
      <h3>Platform Recommendations</h3>
      <div class="alert info">${report.platformRecommendations.map(r => `<p>${escapeHtml(r)}</p>`).join('') || '<p>No recommendations generated yet.</p>'}</div>
    `;
  } catch (err) { showAlert('alert', err.message); }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
