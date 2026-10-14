import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSurveyDraft } from '../supabase/functions/_shared/survey-schema.js';

test('accepts a valid survey draft with supported question types', () => {
  const draft = validateSurveyDraft({
    title: 'Cafe lunch preferences',
    objective: 'Understand what customers want for lunch.',
    template_type: 'feature_preference',
    questions: [
      { question_text: 'What matters most?', question_type: 'single_choice', options: ['Price', 'Taste'] },
      { question_text: 'How likely are you to visit?', question_type: 'rating_5' },
    ],
  });
  assert.equal(draft.questions.length, 2);
  assert.deepEqual(draft.questions[0].options, ['Price', 'Taste']);
});

test('rejects drafts with no questions', () => {
  assert.throws(() => validateSurveyDraft({
    title: 'Test', objective: 'Test objective', template_type: 'custom', questions: [],
  }), /at least one question/i);
});

test('rejects unsupported question types and malformed choice options', () => {
  assert.throws(() => validateSurveyDraft({
    title: 'Test', objective: 'Test objective', template_type: 'custom',
    questions: [{ question_text: 'Question?', question_type: 'freeform_ai_type' }],
  }), /unsupported question type/i);
  assert.throws(() => validateSurveyDraft({
    title: 'Test', objective: 'Test objective', template_type: 'custom',
    questions: [{ question_text: 'Choose?', question_type: 'single_choice', options: ['Only one'] }],
  }), /at least two options/i);
});

test('limits drafts to eight questions and trims generated text', () => {
  const questions = Array.from({ length: 9 }, (_, i) => ({
    question_text: 'Q' + i, question_type: 'short_text',
  }));
  assert.throws(() => validateSurveyDraft({
    title: '  Title  ', objective: '  Objective  ', template_type: 'custom', questions,
  }), /maximum of 8 questions/i);
  const valid = validateSurveyDraft({
    title: '  Title  ', objective: '  Objective  ', template_type: 'custom',
    questions: [{ question_text: '  Q1?  ', question_type: 'short_text' }],
  });
  assert.equal(valid.title, 'Title');
  assert.equal(valid.questions[0].question_text, 'Q1?');
});
