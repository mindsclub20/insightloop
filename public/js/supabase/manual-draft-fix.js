import * as business from './business.js';

window.saveManualDraft = async function saveManualDraftFixed() {
  clearAlert('alert');
  const button = document.querySelector('#draftBuilder button[onclick="saveManualDraft()"]');
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    const title = document.getElementById('title').value.trim();
    const objective = document.getElementById('objective').value.trim();
    if (!title) throw new Error('Enter a survey title before saving.');
    if (!objective) throw new Error('Enter a research objective before saving.');

    const all = await business.listMyStudies();
    const originalTitle = (document.querySelector('#draftBuilder h3')?.textContent || '').replace('Draft created:', '').trim();
    const draft = all.find((study) => String(study.status).toUpperCase() === 'DRAFT' && (study.title === originalTitle || study.title === title));
    if (!draft) throw new Error('Could not find this draft. Create it again, then save.');
    const { questions } = await business.getStudy(draft.id);
    const normalizedQuestions = questions.map((q) => ({
      question_text: q.question_text,
      question_type: q.question_type,
      options: Array.isArray(q.options)
        ? q.options.map((option) => typeof option === 'string' ? option : option.option_text).filter(Boolean)
        : null,
      is_required: q.is_required !== false && q.is_required !== 0,
    }));
    if (!normalizedQuestions.length) throw new Error('Add at least one question before saving.');
    await business.saveSurveyDraft(draft.id, { title, objective, questions: normalizedQuestions });
    showAlert('alert', 'Draft saved to your account. It is not published.', 'success');
    document.querySelector('[data-tab="studies"]')?.click();
  } catch (error) {
    showAlert('alert', error?.message || 'Could not save the draft.');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Save Draft'; }
  }
};

// Replace the earlier chat listeners so every Send click has a visible result.
// This module loads after business-page.js in the dashboard HTML.
(() => {
  const inputOriginal = document.getElementById('surveyChatInput');
  const sendOriginal = document.getElementById('surveyChatSend');
  const skipOriginal = document.getElementById('surveyChatSkip');
  const resetOriginal = document.getElementById('surveyChatReset');
  const messages = document.getElementById('surveyChatMessages');
  if (!inputOriginal || !sendOriginal || !skipOriginal || !resetOriginal || !messages) return;

  const input = inputOriginal.cloneNode(true);
  const send = sendOriginal.cloneNode(true);
  const skip = skipOriginal.cloneNode(true);
  const reset = resetOriginal.cloneNode(true);
  inputOriginal.replaceWith(input);
  sendOriginal.replaceWith(send);
  skipOriginal.replaceWith(skip);
  resetOriginal.replaceWith(reset);

  const steps = [
    { key: 'goal', prompt: 'What do you want to learn? Describe your research goal.', placeholder: 'e.g. Which snacks would students buy, and at what price?', multiline: true },
    { key: 'city', prompt: 'Which city should the survey target?', placeholder: 'Enter a city' },
    { key: 'areas', prompt: 'Which local areas should qualify? Optional; type “any” to include all areas.', placeholder: 'e.g. Central area, Market Road; or any', optional: true },
    { key: 'minAge', prompt: 'What is the minimum participant age?', placeholder: 'e.g. 18', type: 'number' },
    { key: 'maxAge', prompt: 'What is the maximum participant age?', placeholder: 'e.g. 35', type: 'number' },
    { key: 'professions', prompt: 'Which professions should qualify? Optional; type “any” for all professions.', placeholder: 'e.g. students, teachers; or any', optional: true },
    { key: 'participants', prompt: 'How many participants do you want? Choose 10–500.', placeholder: 'e.g. 100', type: 'number' },
    { key: 'reward', prompt: 'How many tokens should each valid participant earn? Minimum: 5.', placeholder: 'e.g. 5', type: 'number' },
  ];
  let index = 0;
  let answers = {};

  function bubble(text, role = 'assistant') {
    const item = document.createElement('div');
    item.className = 'survey-chat-bubble ' + (role === 'user' ? 'user' : 'assistant');
    item.textContent = text;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }
  function displayStep() {
    const step = steps[index];
    if (!step) return;
    document.getElementById('surveyChatPrompt').textContent = step.prompt;
    input.value = '';
    input.placeholder = step.placeholder;
    input.rows = step.multiline ? 3 : 1;
    input.disabled = false;
    send.disabled = false;
    skip.hidden = !step.optional;
    input.focus();
  }
  function resetChat() {
    index = 0;
    answers = {};
    messages.innerHTML = '';
    bubble('I’ll help build your survey. I’ll ask a few details, then generate editable questions.');
    displayStep();
    document.getElementById('aiStatus').textContent = '';
    document.getElementById('surveyChatHint').textContent = 'Your answers are used to prepare a draft. Nothing is published by this chat.';
  }
  function submitAnswer() {
    const step = steps[index];
    if (!step || send.disabled) return;
    const value = input.value.trim();
    if (!value && !step.optional) {
      bubble('Please answer this question to continue.');
      return;
    }
    if (['minAge', 'maxAge'].includes(step.key)) {
      const age = Number(value);
      if (!Number.isInteger(age) || age < 18 || age > 120) { bubble('Enter a whole-number age between 18 and 120.'); return; }
    }
    if (step.key === 'participants') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 10 || n > 500) { bubble('Participant count must be a whole number from 10 to 500.'); return; }
    }
    if (step.key === 'reward') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 5) { bubble('Reward must be a whole number of at least 5 tokens.'); return; }
    }
    if (step.key === 'maxAge' && Number(value) < Number(answers.minAge)) { bubble('Maximum age must be greater than or equal to minimum age.'); return; }
    answers[step.key] = value;
    bubble(value || 'Any / no restriction', 'user');
    index += 1;
    if (index < steps.length) {
      displayStep();
      bubble(steps[index].prompt);
      return;
    }
    finish();
  }
  function finish() {
    const normalizeAny = (v) => /^(any|none|all)$/i.test(v || '') ? '' : (v || '');
    document.getElementById('aiCommand').value = answers.goal;
    document.getElementById('aiTargetCity').value = answers.city;
    document.getElementById('target_city').value = answers.city;
    document.getElementById('target_areas').value = normalizeAny(answers.areas);
    document.getElementById('target_professions').value = normalizeAny(answers.professions);
    document.getElementById('min_age').value = answers.minAge;
    document.getElementById('max_age').value = answers.maxAge;
    document.getElementById('sample_size').value = answers.participants;
    document.getElementById('reward').value = answers.reward;
    document.getElementById('aiTargetCity').value = answers.city;
    document.getElementById('aiStatus').textContent = 'Generating your survey questions…';
    document.getElementById('surveyChatHint').textContent = 'Please wait while Anvesh AI prepares your draft.';
    input.disabled = true;
    send.disabled = true;
    skip.hidden = true;
    const generate = document.getElementById('generateAiSurveyBtn');
    if (!generate) {
      bubble('The AI generator is not available on this page. Refresh and sign in again.');
      document.getElementById('aiStatus').textContent = 'AI generator unavailable.';
      return;
    }
    generate.click();
    window.setTimeout(() => {
      const status = document.getElementById('aiStatus');
      if (status && !status.textContent.trim()) {
        status.textContent = 'AI did not return a response. Check the error message above and try again.';
      }
    }, 1200);
  }
  send.addEventListener('click', submitAnswer);
  skip.addEventListener('click', () => {
    if (!steps[index]?.optional) return;
    answers[steps[index].key] = '';
    bubble('Skipped this optional filter.', 'user');
    index += 1;
    displayStep();
    bubble(steps[index].prompt);
  });
  reset.addEventListener('click', resetChat);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !steps[index]?.multiline) {
      event.preventDefault();
      submitAnswer();
    }
  });
  resetChat();
})();
