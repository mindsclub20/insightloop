// public/js/supabase/business-page.js
//
// WRITTEN, NOT EXECUTED. Page controller for supabase-business/dashboard.html.
// Deliberately mirrors public/js/business.js's structure/UX closely so the
// two tracks feel identical to use - only the data layer underneath differs
// (this one calls public/js/supabase/business.js instead of fetch()'ing
// the local Node API). Functions referenced from dynamically-injected HTML
// (onclick="..." strings built via innerHTML) are attached to `window`
// explicitly, since inline event-handler attributes always resolve against
// the global scope regardless of this file being an ES module.

import { requireRoleSupabase } from './page-auth.js';
import * as business from './business.js';

let CURRENT = null;
let DRAFT_STUDY = null;
let AI_SURVEY_DRAFT = null;
let AI_REQUEST_BUSY = false;

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

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('tab-create').classList.toggle('hidden', name !== 'create');
  document.getElementById('tab-studies').classList.toggle('hidden', name !== 'studies');
  if (name === 'studies') loadStudies();
}

async function init() {
  CURRENT = await requireRoleSupabase('BUSINESS');
  if (!CURRENT) return;
  document.getElementById('dashboardContent').hidden = false;
  document.getElementById('businessNav').hidden = false;
  document.getElementById('userName').textContent = CURRENT.profile.full_name || CURRENT.user.email;

  const biz = await business.getMyBusiness();
  renderVerificationBanner(biz);

  ['sample_size', 'reward'].forEach((id) => document.getElementById(id).addEventListener('input', updateBudgetPreview));
  updateBudgetPreview();
  document.getElementById('createStudyBtn').addEventListener('click', createStudy);
  document.getElementById('generateAiSurveyBtn').addEventListener('click', generateAiSurvey);\n  document.getElementById('generateAiAdBtn').addEventListener('click', generateAiAd);
  document.getElementById('aiCommand').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generateAiSurvey();
  });
}

function renderVerificationBanner(biz) {
  const el = document.getElementById('verificationBanner');
  if (!biz) {
    el.innerHTML = `<div class="alert error">No business found for this account — the create-business step of signup may not have completed. Contact support.</div>`;
  } else if (biz.verification_status === 'VERIFIED') {
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

async function generateAiSurvey() {
  if (AI_REQUEST_BUSY) return;
  clearAlert('alert');
  const command = document.getElementById('aiCommand').value.trim();
  if (command.length < 8) {
    showAlert('alert', 'Describe what you want to learn in at least 8 characters.');
    return;
  }
  const targetCity = document.getElementById('target_city').value.trim();
  if (!targetCity) {
    showAlert('alert', 'Enter the target city in the research details above first.');
    document.getElementById('target_city').focus();
    return;
  }
  const button = document.getElementById('generateAiSurveyBtn');
  const status = document.getElementById('aiStatus');
  AI_REQUEST_BUSY = true;
  button.disabled = true;
  status.textContent = 'Autopilot is designing your survey…';
  let createdStudyId = null;
  try {
    const result = await business.generateAiSurvey({
      command,
      target_city: targetCity,
      sample_size: Number(document.getElementById('sample_size').value),
      reward_per_response_rupees: Number(document.getElementById('reward').value),
      target_min_age: Number(document.getElementById('min_age').value),
      target_max_age: Number(document.getElementById('max_age').value),
      target_gender: document.getElementById('target_gender').value,
    });
    status.textContent = 'Survey generated. Creating it and submitting for platform checks…';
    createdStudyId = await createAndSubmitAutonomousSurvey(result.survey);
    status.textContent = 'Autopilot finished: survey submitted. It is not public yet.';
    document.getElementById('aiSurveyPreview').classList.add('hidden');
    document.getElementById('aiSurveyPreview').innerHTML = '';
    AI_SURVEY_DRAFT = null;
    showAlert('alert', 'Autopilot created and submitted your survey. It remains pending for payment confirmation and platform approval; it has not been published.', 'success');
    switchTab('studies');
    await loadStudies();
  } catch (err) {
    const partialStudyId = err.partialStudyId || createdStudyId;
    status.textContent = partialStudyId
      ? `Autopilot paused. Draft study ${partialStudyId} may need recovery before retrying.`
      : '';
    showAlert('alert', err.message || 'Autopilot could not complete the survey.');
  } finally {
    AI_REQUEST_BUSY = false;
    button.disabled = false;
  }
}

async function createAndSubmitAutonomousSurvey(survey) {
  if (!survey || !Array.isArray(survey.questions) || survey.questions.length < 1 || survey.questions.length > 8) {
    throw new Error('The AI survey failed validation. Nothing was submitted.');
  }
  const params = {
    template_type: survey.template_type,
    title: survey.title,
    objective: survey.objective,
    target_city: document.getElementById('target_city').value.trim(),
    target_min_age: Number(document.getElementById('min_age').value),
    target_max_age: Number(document.getElementById('max_age').value),
    target_gender: document.getElementById('target_gender').value,
    target_tags: document.getElementById('target_tags').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    sample_size: Number(document.getElementById('sample_size').value),
    reward_per_response_paise: Math.round(Number(document.getElementById('reward').value) * 100),
  };
  const study = await business.createStudy(params);
  try {
    for (const question of survey.questions) {
      await business.addQuestion(study.id, {
        question_text: question.question_text,
        question_type: question.question_type,
        options: question.options || null,
        is_required: question.is_required !== false,
      });
    }
    await business.submitForApproval(study.id);
    return study.id;
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown error';
    const recoveryError = new Error(`Autopilot stopped after creating draft ${study.id}. Do not retry until this draft is checked. Details: ${detail}`);
    recoveryError.partialStudyId = study.id;
    throw recoveryError;
  }
}

function renderAiSurveyPreview() {
  const survey = AI_SURVEY_DRAFT;
  const el = document.getElementById('aiSurveyPreview');
  if (!survey) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const typeOptions = ['single_choice', 'multi_choice', 'yes_no', 'rating_5', 'rating_10', 'short_text', 'long_text'];
  el.innerHTML = `
    <div class="card" style="background:#fff;">
      <div class="row"><h3 style="flex:1;">Review your AI-generated survey</h3><span class="badge amber">Draft only</span></div>
      <label for="aiTitle">Survey title</label>
      <input id="aiTitle" maxlength="120" value="${escapeHtml(survey.title)}">
      <label for="aiObjective">Research objective</label>
      <textarea id="aiObjective" maxlength="500">${escapeHtml(survey.objective)}</textarea>
      <div id="aiQuestionsEditor">
        ${survey.questions.map((q, i) => `
          <div class="card" style="padding:14px;margin-top:12px;">
            <h4>Question ${i + 1}</h4>
            <label for="aiQuestionText${i}">Question text</label>
            <input id="aiQuestionText${i}" maxlength="300" value="${escapeHtml(q.question_text)}">
            <label for="aiQuestionType${i}">Answer type</label>
            <select id="aiQuestionType${i}">
              ${typeOptions.map((type) => `<option value="${type}" ${type === q.question_type ? 'selected' : ''}>${type.replaceAll('_', ' ')}</option>`).join('')}
            </select>
            <label for="aiQuestionOptions${i}">Answer options (comma-separated for choice questions)</label>
            <input id="aiQuestionOptions${i}" maxlength="700" value="${escapeHtml((q.options || []).join(', '))}" placeholder="Option A, Option B">
          </div>`).join('')}
      </div>
      <div class="row" style="margin-top:16px;">
        <button id="submitAiSurveyBtn" type="button">Create & submit for admin approval</button>
        <button class="secondary" id="discardAiSurveyBtn" type="button">Discard draft</button>
      </div>
      <p class="muted">Nothing is sent until you press the submit button. After submission, the study stays pending until admin approval.</p>
    </div>`;
  el.classList.remove('hidden');
  document.getElementById('submitAiSurveyBtn').addEventListener('click', submitAiSurvey);
  document.getElementById('discardAiSurveyBtn').addEventListener('click', () => {
    AI_SURVEY_DRAFT = null;
    el.innerHTML = '';
    el.classList.add('hidden');
    document.getElementById('aiStatus').textContent = 'Draft discarded.';
  });
}

function readEditedAiSurvey() {
  if (!AI_SURVEY_DRAFT) throw new Error('Generate a survey draft first.');
  const title = document.getElementById('aiTitle').value.trim();
  const objective = document.getElementById('aiObjective').value.trim();
  if (!title || !objective) throw new Error('Survey title and objective are required.');
  const questions = AI_SURVEY_DRAFT.questions.map((original, i) => {
    const question_text = document.getElementById(`aiQuestionText${i}`).value.trim();
    const question_type = document.getElementById(`aiQuestionType${i}`).value;
    const rawOptions = document.getElementById(`aiQuestionOptions${i}`).value.trim();
    let options = null;
    if (question_type === 'single_choice' || question_type === 'multi_choice') {
      options = rawOptions.split(',').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) throw new Error(`Question ${i + 1} needs at least two answer options.`);
      if (options.length > 8) throw new Error(`Question ${i + 1} can have at most eight answer options.`);
    } else if (question_type === 'yes_no') {
      options = ['Yes', 'No'];
    }
    if (!question_text) throw new Error(`Question ${i + 1} cannot be empty.`);
    return { question_text, question_type, options, is_required: original.is_required !== false };
  });
  if (questions.length < 1 || questions.length > 8) throw new Error('A survey must contain 1 to 8 questions.');
  return { ...AI_SURVEY_DRAFT, title, objective, questions };
}

async function submitAiSurvey() {
  clearAlert('alert');
  const button = document.getElementById('submitAiSurveyBtn');
  button.disabled = true;
  try {
    const survey = readEditedAiSurvey();
    const params = {
      template_type: survey.template_type,
      title: survey.title,
      objective: survey.objective,
      target_city: document.getElementById('target_city').value.trim(),
      target_min_age: Number(document.getElementById('min_age').value),
      target_max_age: Number(document.getElementById('max_age').value),
      target_gender: document.getElementById('target_gender').value,
      target_tags: document.getElementById('target_tags').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      sample_size: Number(document.getElementById('sample_size').value),
      reward_per_response_paise: Math.round(Number(document.getElementById('reward').value) * 100),
    };
    const study = await business.createStudy(params);
    for (const question of survey.questions) {
      await business.addQuestion(study.id, question);
    }
    const result = await business.submitForApproval(study.id);
    AI_SURVEY_DRAFT = null;
    document.getElementById('aiSurveyPreview').innerHTML = `
      <div class="alert success">
        <strong>Survey submitted for admin approval.</strong><br>
        Your survey was created with ${survey.questions.length} questions. It is not public yet; it must pass admin approval. Payment status: ${escapeHtml(result.paymentStatus || 'pending')}.
      </div>`;
    document.getElementById('aiStatus').textContent = 'Submitted for review.';
    showAlert('alert', 'Survey submitted for admin approval. It will not go live until approved.', 'success');
    switchTab('studies');
  } catch (err) {
    showAlert('alert', err.message || 'Could not submit the survey.');
    if (document.getElementById('submitAiSurveyBtn')) document.getElementById('submitAiSurveyBtn').disabled = false;
  }
}


async function generateAiAd() {
  const product = document.getElementById('adProduct').value.trim();
  const audience = document.getElementById('adAudience').value.trim();
  const goal = document.getElementById('adGoal').value;
  const tone = document.getElementById('adTone').value.trim() || 'clear and friendly';
  const button = document.getElementById('generateAiAdBtn');
  const status = document.getElementById('adStatus');
  const preview = document.getElementById('aiAdPreview');
  preview.classList.add('hidden');
  preview.innerHTML = '';
  if (product.length < 3) { status.textContent = 'Describe your product or service first.'; return; }
  button.disabled = true;
  status.textContent = 'Generating a draft…';
  try {
    const result = await business.generateAiAd({ product, audience, goal, tone });
    const ad = result.ad;
    const safe = (value) => escapeHtml(value ?? '');
    preview.innerHTML = `
      <div class="card">
        <span class="badge amber">Draft only · Review before publishing</span>
        <h3>${safe(ad.headline)}</h3>
        <p>${safe(ad.primary_text)}</p>
        <p><strong>Call to action:</strong> ${safe(ad.call_to_action)}</p>
        <h4>Alternative versions</h4>
        <ul>${ad.variations.map((item) => `<li>${safe(item)}</li>`).join('')}</ul>
        <h4>Claims to review</h4>
        <ul>${ad.review_notes.map((item) => `<li>${safe(item)}</li>`).join('') || '<li>Verify every product claim before use.</li>'}</ul>
        <p class="muted">Provider: ${safe(result.provider)}. This draft has not been published.</p>
      </div>`;
    preview.classList.remove('hidden');
    status.textContent = 'Draft ready. Check every claim before using it.';
  } catch (error) {
    status.textContent = error.message || 'Could not generate an advertisement.';
  } finally {
    button.disabled = false;
  }
}

async function createStudy() {
  clearAlert('alert');
  try {
    const study = await business.createStudy({
      template_type: document.getElementById('template_type').value,
      title: document.getElementById('title').value,
      objective: document.getElementById('objective').value,
      target_city: document.getElementById('target_city').value,
      target_min_age: parseInt(document.getElementById('min_age').value, 10),
      target_max_age: parseInt(document.getElementById('max_age').value, 10),
      target_gender: document.getElementById('target_gender').value,
      target_tags: document.getElementById('target_tags').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
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
            <button class="secondary" onclick="addSuggested(${i})">Add</button>
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
  const { questions } = await business.getStudy(DRAFT_STUDY.id);
  document.getElementById('addedQuestions').innerHTML = questions.length
    ? questions.map((q) => `<div class="row"><span style="flex:1;">${q.order_index + 1}. ${escapeHtml(q.question_text)} <span class="muted">(${q.question_type})</span></span></div>`).join('')
    : '<p class="muted">None yet.</p>';
}

async function addSuggested(idx) {
  const q = window._suggestions[idx];
  try {
    await business.addQuestion(DRAFT_STUDY.id, { question_text: q.question_text, question_type: q.question_type, options: q.options || null });
    refreshAddedQuestions();
  } catch (err) { showAlert('alert', err.message); }
}

async function addCustomQuestion() {
  clearAlert('alert');
  const text = document.getElementById('qText').value.trim();
  const type = document.getElementById('qType').value;
  const optsRaw = document.getElementById('qOptions').value.trim();
  const options = optsRaw ? optsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (!text) { showAlert('alert', 'Question text is required'); return; }
  try {
    await business.addQuestion(DRAFT_STUDY.id, { question_text: text, question_type: type, options });
    document.getElementById('qText').value = '';
    document.getElementById('qOptions').value = '';
    refreshAddedQuestions();
  } catch (err) { showAlert('alert', err.message); }
}

async function submitForApproval() {
  clearAlert('alert');
  try {
    const result = await business.submitForApproval(DRAFT_STUDY.id);
    document.getElementById('draftBuilder').innerHTML = `<div class="alert success">Study submitted for admin approval. Payment status: ${result.paymentStatus} (P0: manual payment confirmation, see demo notice).</div>`;
    DRAFT_STUDY = null;
    switchTab('studies');
  } catch (err) { showAlert('alert', err.message); }
}

async function loadStudies() {
  clearAlert('alert');
  try {
    const studies = await business.listMyStudies();
    document.getElementById('studyList').innerHTML = studies.length ? studies.map((s) => `
      <div class="card">
        <div class="row"><h3 style="flex:1;">${escapeHtml(s.title)}</h3>${badge(s.status)}</div>
        <p class="muted">${escapeHtml(s.target_city)} · ${s.sample_size} respondents · ${paise(s.reward_per_response_paise)}/response</p>
        <div class="row">
          <button class="secondary" onclick="viewStudy('${s.id}')">View details${['ACTIVE', 'COMPLETED', 'REPORT_READY'].includes(s.status) ? ' & report' : ''}</button>
          ${['DRAFT', 'SUBMITTED'].includes(s.status) ? `<button class="danger" onclick="cancelStudy('${s.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `).join('') : '<p class="muted">No studies yet — create one from the "Create Research" tab.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function cancelStudy(id) {
  if (!confirm('Cancel this study? This cannot be undone.')) return;
  try { await business.cancelStudy(id); loadStudies(); }
  catch (err) { showAlert('alert', err.message); }
}

async function viewStudy(id) {
  clearAlert('alert');
  try {
    const { study, questions } = await business.getStudy(id);
    // NOTE: no per-status response counts shown here, unlike the SQLite
    // track's equivalent page. Businesses have no SELECT grant on
    // survey_responses at all under RLS (002/004) - not filtered, not
    // present - so there is no client-side query that could produce that
    // number even in principle. The report (generate-report) below
    // supplies the equivalent aggregate figures instead.
    let html = `<div class="card">
      <h3>${escapeHtml(study.title)} ${badge(study.status)}</h3>
      <p class="muted">${study.sample_size} target respondents · ${paise(study.reward_per_response_paise)}/response · ${questions.length} question${questions.length === 1 ? '' : 's'}</p>`;
    if (study.status === 'REJECTED') html += `<p class="alert error">Rejected: ${escapeHtml(study.rejection_reason || '')}</p>`;
    if (['ACTIVE', 'COMPLETED', 'REPORT_READY'].includes(study.status)) {
      html += `<button onclick="viewReport('${study.id}')">View insights report</button>`;
    }
    html += `<div id="reportArea" style="margin-top:14px;"></div></div>`;
    document.getElementById('studyDetail').innerHTML = html;
  } catch (err) { showAlert('alert', err.message); }
}

async function viewReport(id) {
  try {
    const report = await business.getStudyReport(id);
    const qHtml = report.questionAnalytics.map((q) => {
      if (q.breakdown) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3>
          <table><tbody>${q.breakdown.map((b) => `<tr><td>${escapeHtml(b.option)}</td><td>${b.count}</td><td>${b.percent ?? b.percentOfRespondents}%</td></tr>`).join('')}</tbody></table></div>`;
      }
      if (q.average !== undefined) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3><p>Average rating: <strong>${q.average ?? 'N/A'}</strong> (${q.responseCount} responses)</p></div>`;
      }
      return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3>
        <p class="muted">Top themes: ${(q.topThemes || []).map((t) => t.word).join(', ') || 'Not enough data'}</p></div>`;
    }).join('');

    document.getElementById('reportArea').innerHTML = `
      <h3>Observed Results</h3>
      <p>Total responses: ${report.observedResults.totalResponses} · Valid: ${report.observedResults.validResponses} · Flagged/Rejected: ${report.observedResults.flaggedOrRejected}</p>
      <h3>Calculated Statistics</h3>
      <p>Completion rate: ${report.calculatedStatistics.completionRatePercent}% · Valid response rate: ${report.calculatedStatistics.validResponseRatePercent}%</p>
      <h3>Question Analytics (Observed)</h3>
      ${qHtml}
      <h3>Platform Recommendations</h3>
      <div class="alert info">${report.platformRecommendations.map((r) => `<p>${escapeHtml(r)}</p>`).join('') || '<p>No recommendations generated yet.</p>'}</div>
    `;
  } catch (err) { showAlert('alert', err.message); }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Attach everything referenced from injected-HTML onclick="..." strings.
Object.assign(window, { addSuggested, addCustomQuestion, submitForApproval, viewStudy, cancelStudy, viewReport });

init().catch((error) => {
  console.error('Business dashboard initialization failed.');
  window.location.href = '/supabase-login.html';
});
