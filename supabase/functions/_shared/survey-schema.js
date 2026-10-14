// Shared validation for AI-generated survey drafts. This module is also imported by Node tests.
export const SURVEY_TEMPLATES = [
  'pricing_test', 'feature_preference', 'purchase_intent',
  'satisfaction', 'timing_location', 'custom',
];
export const QUESTION_TYPES = [
  'single_choice', 'multi_choice', 'yes_no', 'rating_5',
  'rating_10', 'short_text', 'long_text',
];

export function validateSurveyDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('AI response must be a survey object.');
  }
  const title = cleanText(input.title, 'Survey title', 120);
  const objective = cleanText(input.objective, 'Survey objective', 500);
  const template_type = SURVEY_TEMPLATES.includes(input.template_type) ? input.template_type : 'custom';
  if (!Array.isArray(input.questions) || input.questions.length < 1) {
    throw new Error('The survey must contain at least one question.');
  }
  if (input.questions.length > 8) throw new Error('Survey drafts have a maximum of 8 questions.');

  const questions = input.questions.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Question ${index + 1} is invalid.`);
    }
    const question_text = cleanText(raw.question_text, `Question ${index + 1}`, 300);
    if (!QUESTION_TYPES.includes(raw.question_type)) {
      throw new Error(`Question ${index + 1} has an unsupported question type.`);
    }
    let options = null;
    if (raw.question_type === 'single_choice' || raw.question_type === 'multi_choice') {
      if (!Array.isArray(raw.options) || raw.options.length < 2) {
        throw new Error(`Question ${index + 1} needs at least two options.`);
      }
      if (raw.options.length > 8) throw new Error(`Question ${index + 1} has too many options.`);
      options = raw.options.map((option, optionIndex) => cleanText(option, `Question ${index + 1} option ${optionIndex + 1}`, 100));
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
        throw new Error(`Question ${index + 1} has duplicate options.`);
      }
    } else if (raw.question_type === 'yes_no') {
      options = ['Yes', 'No'];
    }
    return { question_text, question_type: raw.question_type, options, is_required: raw.is_required !== false };
  });
  return { title, objective, template_type, questions };
}

function cleanText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return cleaned;
}
