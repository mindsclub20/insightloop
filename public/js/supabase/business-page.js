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
import { calculateTokenBudget } from './token-budget.js';

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
  document.getElementById('tab-results').classList.toggle('hidden', name !== 'results');
  if (name === 'studies') loadStudies();
  if (name === 'results') loadResults();
}

async function init() {
  CURRENT = await requireRoleSupabase('BUSINESS');
  if (!CURRENT) return;
  document.getElementById('userName').textContent = CURRENT.profile.full_name || CURRENT.user.email;

  const biz = await business.getMyBusiness();
  renderVerificationBanner(biz);

  ['sample_size', 'reward'].forEach((id) => document.getElementById(id).addEventListener('input', updateBudgetPreview));
  updateBudgetPreview();
  document.getElementById('createStudyBtn').addEventListener('click', createStudy);
  const aiCity = document.getElementById('aiTargetCity');
  aiCity.value = document.getElementById('target_city').value;
  aiCity.addEventListener('input', () => { document.getElementById('target_city').value = aiCity.value; });
  document.querySelectorAll('.ai-chip').forEach((chip) => chip.addEventListener('click', () => {
    const prompt = document.getElementById('aiCommand');
    prompt.value = chip.dataset.prompt || '';
    prompt.focus();
  }));
  document.getElementById('generateAiSurveyBtn').addEventListener('click', generateAiSurvey);
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
    el.innerHTML = `<div class="alert info">Your business can create and save drafts without admin verification. Keep drafts private until you choose to publish.</div>`;
  } else {
    el.innerHTML = `<div class="alert error">Business verification is not required to create or publish a survey.</div>`;
  }
}

function csvValues(id, lower = false) {
  return (document.getElementById(id)?.value || '').split(',').map((value) => value.trim()).filter(Boolean)
    .map((value) => lower ? value.toLowerCase() : value).slice(0, 30);
}

function updateBudgetPreview() {
  const sample = Number(document.getElementById('sample_size').value);
  const reward = Number(document.getElementById('reward').value);
  try {
    const budget = calculateTokenBudget(sample, reward);
    document.getElementById('budgetPreview').textContent =
      `Participant rewards: ${budget.participantRewardBudget.toLocaleString()} tokens (${sample} × ${reward}) + ${budget.platformFee}-token platform fee = ${budget.totalRequired.toLocaleString()} tokens total.`;
  } catch {
    document.getElementById('budgetPreview').textContent = 'Choose 10–500 participants and at least 5 whole tokens per participant.';
  }
}


const SURVEY_CHAT_STEPS = [
  { key: 'goal', prompt: 'What do you want to learn? Describe your research goal.', placeholder: 'e.g. Which snacks would students buy, and at what price?', multiline: true },
  { key: 'city', prompt: 'Which city should the survey target?', placeholder: 'Enter a city' },
  { key: 'areas', prompt: 'Which local areas should qualify? Optional: enter areas separated by commas, or type “any”.', placeholder: 'e.g. Central area, Market Road; or any', optional: true },
  { key: 'minAge', prompt: 'What is the minimum participant age?', placeholder: 'e.g. 18', type: 'number' },
  { key: 'maxAge', prompt: 'What is the maximum participant age?', placeholder: 'e.g. 35', type: 'number' },
  { key: 'professions', prompt: 'Which professions should qualify? Optional: enter comma-separated professions, or type “any”.', placeholder: 'e.g. students, teachers; or any', optional: true },
  { key: 'participants', prompt: 'How many participants do you want? Choose 10–500.', placeholder: 'e.g. 100', type: 'number' },
  { key: 'reward', prompt: 'How many tokens should each valid participant earn? The minimum is 5; you can offer more.', placeholder: 'e.g. 5', type: 'number' },
];
let SURVEY_CHAT_INDEX = 0;
let SURVEY_CHAT_ANSWERS = {};

function initSurveyChat() {
  const input = document.getElementById('surveyChatInput');
  const send = document.getElementById('surveyChatSend');
  const skip = document.getElementById('surveyChatSkip');
  const reset = document.getElementById('surveyChatReset');
  if (!input || !send || !skip || !reset) return;
  showSurveyChatPrompt();
  send.addEventListener('click', submitSurveyChatAnswer);
  skip.addEventListener('click', () => {
    const step = SURVEY_CHAT_STEPS[SURVEY_CHAT_INDEX];
    if (!step?.optional) return;
    appendSurveyChatMessage('You can include anyone for this field.', 'user');
    SURVEY_CHAT_ANSWERS[step.key] = '';
    advanceSurveyChat();
  });
  reset.addEventListener('click', resetSurveyChat);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !input.multiline) {
      event.preventDefault();
      submitSurveyChatAnswer();
    }
  });
}

function appendSurveyChatMessage(message, role) {
  const messages = document.getElementById('surveyChatMessages');
  const bubble = document.createElement('div');
  bubble.className = 'survey-chat-bubble ' + (role === 'user' ? 'user' : 'assistant');
  bubble.textContent = message;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function showSurveyChatPrompt() {
  const step = SURVEY_CHAT_STEPS[SURVEY_CHAT_INDEX];
  const input = document.getElementById('surveyChatInput');
  const prompt = document.getElementById('surveyChatPrompt');
  const skip = document.getElementById('surveyChatSkip');
  if (!step) return;
  prompt.textContent = step.prompt;
  input.value = '';
  input.placeholder = step.placeholder;
  input.type = step.type || 'text';
  input.rows = step.multiline ? 3 : 1;
  input.multiline = Boolean(step.multiline);
  skip.hidden = !step.optional;
  input.focus();
}

function submitSurveyChatAnswer() {
  const step = SURVEY_CHAT_STEPS[SURVEY_CHAT_INDEX];
  const input = document.getElementById('surveyChatInput');
  if (!step || !input) return;
  const value = input.value.trim();
  if (!value && !step.optional) {
    appendSurveyChatMessage('Please answer this question to continue.', 'assistant');
    return;
  }
  if (step.key === 'minAge' || step.key === 'maxAge') {
    const age = Number(value);
    if (!Number.isInteger(age) || age < 18 || age > 120) {
      appendSurveyChatMessage('Enter a whole-number age between 18 and 120.', 'assistant');
      return;
    }
  }
  if (step.key === 'participants') {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 10 || count > 500) {
      appendSurveyChatMessage('Participant count must be a whole number from 10 to 500.', 'assistant');
      return;
    }
  }
  if (step.key === 'reward') {
    const reward = Number(value);
    if (!Number.isInteger(reward) || reward < 5 || reward > 1000000) {
      appendSurveyChatMessage('Reward must be a whole number of at least 5 tokens per participant.', 'assistant');
      return;
    }
  }
  if (step.key === 'maxAge' && Number(value) < Number(SURVEY_CHAT_ANSWERS.minAge)) {
    appendSurveyChatMessage('Maximum age must be greater than or equal to the minimum age.', 'assistant');
    return;
  }
  SURVEY_CHAT_ANSWERS[step.key] = value;
  appendSurveyChatMessage(value || 'Any / no restriction', 'user');
  advanceSurveyChat();
}

function advanceSurveyChat() {
  SURVEY_CHAT_INDEX += 1;
  if (SURVEY_CHAT_INDEX < SURVEY_CHAT_STEPS.length) {
    showSurveyChatPrompt();
    return;
  }
  finishSurveyChat();
}

async function finishSurveyChat() {
  const a = SURVEY_CHAT_ANSWERS;
  const areas = /^(any|none|all)$/i.test(a.areas || '') ? '' : (a.areas || '');
  const professions = /^(any|none|all)$/i.test(a.professions || '') ? '' : (a.professions || '');
  document.getElementById('aiCommand').value = a.goal;
  document.getElementById('aiTargetCity').value = a.city;
  document.getElementById('target_city').value = a.city;
  document.getElementById('target_areas').value = areas;
  document.getElementById('target_professions').value = professions;
  document.getElementById('min_age').value = a.minAge;
  document.getElementById('max_age').value = a.maxAge;
  document.getElementById('sample_size').value = a.participants;
  document.getElementById('reward').value = a.reward;
  updateBudgetPreview();
  const budget = calculateTokenBudget(Number(a.participants), Number(a.reward));
  appendSurveyChatMessage(
    `Summary: ${a.city}; ages ${a.minAge}–${a.maxAge}; areas ${areas || 'any'}; professions ${professions || 'any'}; ${a.participants} participants; ${a.reward} tokens each. Participant reserve ${budget.participantRewardBudget.toLocaleString()} + 100 fee = ${budget.totalRequired.toLocaleString()} tokens. I’ll generate the questions now; nothing is published or charged until you confirm.`,
    'assistant'
  );
  document.getElementById('surveyChatInput').disabled = true;
  document.getElementById('surveyChatSend').disabled = true;
  document.getElementById('surveyChatSkip').hidden = true;
  document.getElementById('aiStatus').textContent = 'Generating questions…';
  await generateAiSurvey();
  document.getElementById('surveyChatHint').textContent = 'Review and edit the questions below. No tokens are deducted until you confirm publishing.';
}

function resetSurveyChat() {
  SURVEY_CHAT_INDEX = 0;
  SURVEY_CHAT_ANSWERS = {};
  const messages = document.getElementById('surveyChatMessages');
  messages.innerHTML = '';
  appendSurveyChatMessage('I’ll help build your survey. First, what do you want to learn?', 'assistant');
  document.getElementById('surveyChatInput').disabled = false;
  document.getElementById('surveyChatSend').disabled = false;
  document.getElementById('aiStatus').textContent = '';
  showSurveyChatPrompt();
}

// Initialize the visible chat independently of authentication/profile loading.
initSurveyChat();

async function generateAiSurvey() {
  if (AI_REQUEST_BUSY) return;
  clearAlert('alert');
  const command = document.getElementById('aiCommand').value.trim();
  if (command.length < 8) {
    showAlert('alert', 'Describe what you want to learn in at least 8 characters.');
    return;
  }
  const targetCity = (document.getElementById('aiTargetCity')?.value || document.getElementById('target_city').value).trim();
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
  try {
    const result = await business.generateAiSurvey({
      command,
      target_city: targetCity,
      sample_size: Number(document.getElementById('sample_size').value),
      reward_per_response_rupees: 1,
      reward_per_response_tokens: Number(document.getElementById('reward').value),
      target_areas: csvValues('target_areas'),
      target_professions: csvValues('target_professions', true),
      target_min_age: Number(document.getElementById('min_age').value),
      target_max_age: Number(document.getElementById('max_age').value),
      target_gender: document.getElementById('target_gender').value,
    });
    if (!result?.survey || !Array.isArray(result.survey.questions) || result.survey.questions.length < 1 || result.survey.questions.length > 8) {
      throw new Error('The AI survey failed validation. Please generate it again.');
    }
    AI_SURVEY_DRAFT = result.survey;
    status.textContent = 'Survey ready — review and edit the questions below.';
    renderAiSurveyPreview();
    document.getElementById('aiSurveyPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showAlert('alert', err.message || 'AI could not generate the survey.');
    status.textContent = '';
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
        <button id="saveAiSurveyBtn" type="button">Save Draft</button>
        <button id="publishAiSurveyBtn" type="button">Publish Survey</button>
        <button class="secondary" id="discardAiSurveyBtn" type="button">Discard draft</button>
      </div>
      <p class="muted">Publishing reserves participant rewards and deducts a separate 100-token platform fee. Minimum reward: 5 tokens per valid completion. Your survey activates only after you confirm and funding succeeds.</p>
    </div>`;
  el.classList.remove('hidden');
  document.getElementById('saveAiSurveyBtn').addEventListener('click', () => persistAiSurvey(false));
  document.getElementById('publishAiSurveyBtn').addEventListener('click', () => persistAiSurvey(true));
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

async function persistAiSurvey(publish) {
  clearAlert('alert');
  const saveButton = document.getElementById('saveAiSurveyBtn');
  const publishButton = document.getElementById('publishAiSurveyBtn');
  if (saveButton) saveButton.disabled = true;
  if (publishButton) publishButton.disabled = true;
  let savedId = AI_SURVEY_DRAFT?.research_project_id || null;
  try {
    const survey = readEditedAiSurvey();
    if (!savedId) {
      const params = {
        template_type: survey.template_type || document.getElementById('template_type').value,
        title: survey.title,
        objective: survey.objective,
        target_city: (document.getElementById('aiTargetCity')?.value || document.getElementById('target_city').value).trim(),
        target_min_age: Number(document.getElementById('min_age').value),
        target_max_age: Number(document.getElementById('max_age').value),
        target_gender: document.getElementById('target_gender').value,
        target_tags: document.getElementById('target_tags').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        target_areas: csvValues('target_areas'),
        target_professions: csvValues('target_professions', true),
        sample_size: Number(document.getElementById('sample_size').value),
        reward_per_response_tokens: Number(document.getElementById('reward').value),
      };
      const study = await business.createStudy(params);
      savedId = study.id;
      AI_SURVEY_DRAFT = { ...survey, research_project_id: savedId };
    }
    await business.saveSurveyDraft(savedId, survey);
    if (!publish) {
      document.getElementById('aiStatus').textContent = 'Draft saved to your account.';
      showAlert('alert', 'Draft saved successfully. You can return to Saved Drafts later.', 'success');
      await loadStudies();
      return;
    }
    const rewardTokens = Number(document.getElementById('reward').value);
    const participantCount = Number(document.getElementById('sample_size').value);
    const tokenBudget = calculateTokenBudget(participantCount, rewardTokens);
    const rewardBudget = tokenBudget.participantRewardBudget;
    const totalTokens = tokenBudget.totalRequired;
    const confirmed = window.confirm(`Publish this survey now?\n\nParticipants: ${participantCount}\nReward per valid completion: ${rewardTokens} tokens\nParticipant reward budget: ${rewardBudget.toLocaleString()} tokens\nPlatform fee: 100 tokens\nTOTAL DEDUCTED: ${totalTokens.toLocaleString()} tokens\n\nThe survey will activate immediately if funding succeeds.`);
    if (!confirmed) {
      document.getElementById('aiStatus').textContent = 'Publishing cancelled. No tokens were deducted.';
      return;
    }
    const result = await business.publishSurvey(savedId, {
      reward_per_response_tokens: rewardTokens,
      target_areas: csvValues('target_areas'),
      target_professions: csvValues('target_professions', true),
    });
    AI_SURVEY_DRAFT = null;
    document.getElementById('aiSurveyPreview').innerHTML = `<div class="alert success"><strong>Survey published successfully.</strong><br>${escapeHtml(result.survey?.title || survey.title)} is now active.</div>`;
    document.getElementById('aiStatus').textContent = 'Published.';
    showAlert('alert', 'Survey published successfully.', 'success');
    switchTab('results');
  } catch (err) {
    showAlert('alert', err.message || 'Could not save or publish the survey.');
    document.getElementById('aiStatus').textContent = savedId
      ? 'Your draft record exists. Try saving again; do not create a duplicate.'
      : '';
  } finally {
    if (document.getElementById('saveAiSurveyBtn')) document.getElementById('saveAiSurveyBtn').disabled = false;
    if (document.getElementById('publishAiSurveyBtn')) document.getElementById('publishAiSurveyBtn').disabled = false;
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
      target_areas: csvValues('target_areas'),
      target_professions: csvValues('target_professions', true),
      reward_per_response_tokens: Number(document.getElementById('reward').value),
      reward_per_response_paise: 0,
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
      <p class="muted">Suggested questions for this template (add the questions you want, then save or publish). Max 8 questions.</p>
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

      <div class="row" style="margin-top:16px;"><button class="secondary" onclick="saveManualDraft()">Save Draft</button><button onclick="submitForApproval()">Publish Survey</button></div>
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

async function saveManualDraft() {
  if (!DRAFT_STUDY) { showAlert('alert', 'Create a draft first.'); return; }
  try {
    await business.getStudy(DRAFT_STUDY.id);
    showAlert('alert', 'Draft and its questions are saved to your account.', 'success');
    await loadStudies();
  } catch (err) { showAlert('alert', err.message || 'Could not confirm the draft was saved.'); }
}

async function submitForApproval() {
  clearAlert('alert');
  try {
    if (!DRAFT_STUDY) throw new Error('Create a draft first.');
    const { questions } = await business.getStudy(DRAFT_STUDY.id);
    if (!questions.length) throw new Error('Add at least one question before publishing.');
    const reward = Number(document.getElementById('reward').value);
    const sample = Number(document.getElementById('sample_size').value);
    const tokenBudget = calculateTokenBudget(sample, reward);
    const total = tokenBudget.totalRequired;
    if (!window.confirm(`Publish this survey now?\n\nParticipants: ${sample}\nReward per valid completion: ${reward} tokens\nParticipant reward budget: ${(sample * reward).toLocaleString()} tokens\nPlatform fee: 100 tokens\nTOTAL DEDUCTED: ${total.toLocaleString()} tokens\n\nThe survey activates immediately if funding succeeds.`)) return;
    const result = await business.publishSurvey(DRAFT_STUDY.id, {
      reward_per_response_tokens: reward,
      target_areas: csvValues('target_areas'),
      target_professions: csvValues('target_professions', true),
    });
    document.getElementById('draftBuilder').innerHTML = `<div class="alert success">Survey published successfully: ${escapeHtml(result.survey?.title || DRAFT_STUDY.title)}.</div>`;
    DRAFT_STUDY = null;
    switchTab('results');
  } catch (err) { showAlert('alert', err.message); }
}

async function loadStudies() {
  clearAlert('alert');
  try {
    const allStudies = await business.listMyStudies();
    const studies = allStudies.filter((s) => ['DRAFT', 'SUBMITTED', 'PENDING', 'UNDER_REVIEW'].includes(String(s.status).toUpperCase()));
    document.getElementById('studyList').innerHTML = studies.length ? studies.map((s) => `
      <div class="card">
        <div class="row"><h3 style="flex:1;">${escapeHtml(s.title)}</h3>${badge(s.status)}</div>
        <p class="muted">${escapeHtml(s.target_city)} · ${s.sample_size} respondents · ${Number(s.reward_per_response_tokens ?? 0).toLocaleString('en-IN')} tokens/response</p>
        <div class="row">
          <button class="secondary" onclick="viewStudy('${s.id}')">View details${['ACTIVE', 'COMPLETED', 'REPORT_READY'].includes(s.status) ? ' & report' : ''}</button>
          ${String(s.status).toUpperCase() === 'DRAFT' ? `<button type="button" onclick="startDraftSurvey('${s.id}')">Start Survey</button>` : ''}
          ${['DRAFT', 'SUBMITTED'].includes(String(s.status).toUpperCase()) ? `<button class="danger" onclick="cancelStudy('${s.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `).join('') : '<p class="muted">No saved drafts or pending surveys yet. Create one from Survey Generation.</p>';
  } catch (err) { showAlert('alert', err.message); }
}

async function loadResults() {
  const list = document.getElementById('resultsList');
  list.innerHTML = '<p class="muted">Loading survey results…</p>';
  document.getElementById('resultsDetail').innerHTML = '';
  try {
    const studies = await business.listMyStudies();
    const published = studies.filter((s) => ['ACTIVE', 'COMPLETED', 'REPORT_READY'].includes(String(s.status).toUpperCase()));
    list.innerHTML = published.length ? published.map((s) => `
      <div class="card">
        <div class="row"><h3 style="flex:1;">${escapeHtml(s.title)}</h3>${badge(s.status)}</div>
        <p class="muted">${escapeHtml(s.target_city)} · ${s.sample_size} target respondents</p>
        <button type="button" onclick="viewResultsReport('${s.id}')">View results</button>
      </div>
    `).join('') : '<p class="muted">No published surveys with results yet. Once a survey is active or completed, its results will appear here.</p>';
  } catch (err) {
    list.innerHTML = '<div class="alert error">Could not load survey results. Please try again.</div>';
    showAlert('alert', err.message);
  }
}

async function viewResultsReport(id) {
  const detail = document.getElementById('resultsDetail');
  detail.innerHTML = '<p class="muted">Loading report…</p>';
  try {
    const report = await business.getStudyReport(id);
    const qHtml = (report.questionAnalytics || []).map((q) => {
      if (q.breakdown) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3>
          <table><tbody>${q.breakdown.map((b) => `<tr><td>${escapeHtml(b.option)}</td><td>${b.count}</td><td>${b.percent ?? b.percentOfRespondents}%</td></tr>`).join('')}</tbody></table></div>`;
      }
      if (q.average !== undefined) {
        return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3><p>Average rating: <strong>${q.average ?? 'N/A'}</strong> (${q.responseCount} responses)</p></div>`;
      }
      return `<div class="card"><h3>${escapeHtml(q.questionText)}</h3><p class="muted">Top themes: ${(q.topThemes || []).map((t) => escapeHtml(t.word)).join(', ') || 'Not enough data'}</p></div>`;
    }).join('');
    detail.innerHTML = `
      <div class="card">
        <h3>Observed Results</h3>
        <p>Total responses: ${report.observedResults.totalResponses} · Valid: ${report.observedResults.validResponses} · Flagged/Rejected: ${report.observedResults.flaggedOrRejected}</p>
        <h3>Calculated Statistics</h3>
        <p>Completion rate: ${report.calculatedStatistics.completionRatePercent}% · Valid response rate: ${report.calculatedStatistics.validResponseRatePercent}%</p>
        <h3>Question Analytics</h3>${qHtml}
        <h3>Recommendations</h3>
        <div class="alert info">${(report.platformRecommendations || []).map((r) => `<p>${escapeHtml(r)}</p>`).join('') || '<p>No recommendations generated yet.</p>'}</div>
      </div>`;
  } catch (err) {
    detail.innerHTML = '<div class="alert error">Results are not available yet for this survey.</div>';
    showAlert('alert', err.message);
  }
}

async function startDraftSurvey(id) {
  clearAlert('alert');
  try {
    const { study, questions } = await business.getStudy(id);
    if (String(study.status).toUpperCase() !== 'DRAFT') throw new Error('Only saved drafts can be started from this action. Refresh the list and try again.');
    if (!questions.length) throw new Error('Add at least one question before starting this survey. Open View details to check the draft.');
    const rewardTokens = Number(study.reward_per_response_tokens ?? (Number(study.reward_per_response_paise || 0) / 100));
    const participantCount = Number(study.sample_size);
    const budget = calculateTokenBudget(participantCount, rewardTokens);
    const confirmed = window.confirm('Start this survey now?\n\nParticipants: ' + participantCount + '\nReward per valid completion: ' + rewardTokens + ' tokens\nParticipant reward budget: ' + budget.participantRewardBudget.toLocaleString() + ' tokens\nPlatform fee: ' + budget.platformFee + ' tokens\nTotal required: ' + budget.totalRequired.toLocaleString() + ' tokens\n\nPublishing will attempt to reserve/deduct this budget.');
    if (!confirmed) return;
    const result = await business.publishSurvey(id, { reward_per_response_tokens: rewardTokens, target_areas: Array.isArray(study.target_areas) ? study.target_areas : [], target_professions: Array.isArray(study.target_professions) ? study.target_professions : [] });
    showAlert('alert', 'Survey started successfully: ' + (result.survey?.title || study.title) + '.', 'success');
    await loadStudies();
    await loadResults();
  } catch (err) { showAlert('alert', err.message || 'Could not start this survey.'); }
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
Object.assign(window, { addSuggested, addCustomQuestion, saveManualDraft, submitForApproval, viewStudy, startDraftSurvey, cancelStudy, viewReport, viewResultsReport });

init().catch((error) => {
  console.error('Business dashboard initialization failed:', error);
  const status = document.getElementById('aiStatus');
  if (status) status.textContent = 'Sign in to your business account to use survey generation.';
});
