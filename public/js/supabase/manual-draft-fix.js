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
    const draft = all.find((study) => study.status === 'DRAFT' && study.title === title);
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
