import { invoke } from '/js/supabase/client.js';

const $ = (id) => document.getElementById(id);
const form = $('plannerForm');
const status = $('liveResearchStatus');
const output = $('liveResearchOutput');
const runButton = $('runLiveResearchBtn');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function list(items) {
  if (!Array.isArray(items) || !items.length) return '<p class="muted">No items returned.</p>';
  return '<ul>' + items.map(item => '<li>' + esc(typeof item === 'string' ? item : JSON.stringify(item)) + '</li>').join('') + '</ul>';
}
function card(title, content) { return '<article class="result-card"><h3>' + esc(title) + '</h3>' + content + '</article>'; }

runButton?.addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  const problem = $('problem').value.trim();
  if (problem.length < 8) { status.textContent = 'Describe the business problem in at least 8 characters.'; return; }
  runButton.disabled = true;
  runButton.textContent = 'Research agents working…';
  status.textContent = 'Calling Anvesh AI research. This uses the connected Gemini-grounded search workflow and records AI usage in the connected Anvesh account.';
  output.innerHTML = '';
  try {
    const result = await invoke('anvesh-research-agent', {
      action: 'plan',
      title: $('title').value.trim(),
      problem,
      city: $('city').value.trim(),
      audience: $('audience').value.trim(),
      method: $('method').value,
      sample_size: Number($('sample').value || 100),
      reward_per_response_tokens: 5
    });
    const research = result?.research;
    if (!result?.ok || !research) throw new Error(result?.error || 'The research agent returned no usable result.');
    const sources = Array.isArray(research.sources) ? research.sources : [];
    const sourceHtml = sources.length
      ? '<ul>' + sources.map(s => '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || s.url) + '</a></li>').join('') + '</ul>'
      : '<p>No grounded source links returned. Verify sources manually.</p>';
    output.innerHTML = [
      card('Research plan', '<p>' + esc(research.plan?.method_rationale || research.plan?.recommended_method || '') + '</p>' + list(research.plan?.research_objectives) + '<h4>Research questions</h4>' + list(research.plan?.research_questions)),
      card('Web evidence and sources', '<p>' + esc(research.web_evidence?.summary || '') + '</p>' + list(research.web_evidence?.existing_evidence?.map(e => (e.claim || '') + (e.source_title ? ' — ' + e.source_title : '') + (e.source_url ? ' (' + e.source_url + ')' : ''))) + sourceHtml),
      card('Proposed survey', '<p><strong>' + esc(research.survey?.title || result.title) + '</strong></p><p>' + esc(research.survey?.objective || '') + '</p>' + list(research.survey?.questions?.map(q => (q.question_text || '') + (q.question_type ? ' [' + q.question_type + ']' : '')))),
      card('Preliminary report', '<p>' + esc(research.preliminary_report?.executive_summary || '') + '</p><h4>Recommendations</h4>' + list(research.preliminary_report?.recommendations) + '<h4>Limitations</h4>' + list(research.preliminary_report?.risks_and_limitations)),
      card('Quality review', '<p>Ready for business review: <strong>' + esc(research.quality_review?.ready_for_business_review ? 'Yes, review required' : 'Needs review') + '</strong></p>' + list(research.quality_review?.issues) + list(research.quality_review?.required_disclaimers)),
      card('Usage and limitations', list(result.warnings))
    ].join('');
    status.textContent = 'Research plan generated. Nothing was published and no participant rewards were deducted.';
  } catch (error) {
    status.textContent = error?.message || 'Research failed. Check sign-in, AI configuration, quota and function logs.';
  } finally {
    runButton.disabled = false;
    runButton.textContent = 'Run AI research';
  }
});
