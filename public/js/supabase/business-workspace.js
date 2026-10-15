import { requireRoleSupabase } from './page-auth.js';
import * as business from './business.js';

let currentUser = null;
let activeDraft = null;
let editorQuestions = [];
let busy = false;

const $ = (id) => document.getElementById(id);
const templates = ['custom','pricing_test','feature_preference','purchase_intent','satisfaction','timing_location'];
const types = ['single_choice','multi_choice','yes_no','rating_5','rating_10','short_text','long_text'];

function alertMsg(message, kind='error') {
  const el=$('alert'); el.textContent=message; el.className='alert '+kind;
}
function clearAlert(){ $('alert').className='alert hidden'; $('alert').textContent=''; }
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function panel(name){
  document.querySelectorAll('.panel-tab').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+name));
  if(name==='drafts') loadDrafts();
  if(name==='results') loadResults();
}
document.querySelectorAll('.panel-tab').forEach(b=>b.addEventListener('click',()=>panel(b.dataset.panel)));

async function init(){
  currentUser=await requireRoleSupabase('BUSINESS');
  if(!currentUser)return;
  $('userName').textContent=currentUser.profile?.full_name||currentUser.user?.email||'Business';
  try{
    const biz=await business.getMyBusiness();
    if(!biz)$('businessNotice').innerHTML='<div class="alert error">No business profile is linked to this account.</div>';
    else if(biz.verification_status!=='VERIFIED')$('businessNotice').innerHTML='<div class="notice">Your business account must be verified before creating or publishing surveys. Drafts remain available.</div>';
  }catch(e){$('businessNotice').innerHTML='<div class="notice">Business status could not be loaded.</div>';}
  $('startManual').addEventListener('click',createManualDraft);
  $('generateAI').addEventListener('click',generateForNewDraft);
  $('refreshDrafts').addEventListener('click',loadDrafts);
  $('refreshResults').addEventListener('click',loadResults);
}

function baseParams(title,objective,template){
  const city=$('city').value.trim();
  const sample=Number($('sample').value);
  const reward=Math.round(Number($('reward').value)*100);
  if(!title.trim()||!objective.trim()||!city)throw new Error('Enter a survey title, research goal, and target city.');
  if(!Number.isFinite(reward)||reward<100)throw new Error('Reward must be at least ₹1 per response.');
  return {title:title.trim(),objective:objective.trim(),template_type:templates.includes(template)?template:'custom',target_city:city,target_min_age:18,target_max_age:65,target_gender:'any',target_tags:[],sample_size:sample,reward_per_response_paise:reward};
}
async function createManualDraft(){
  clearAlert();
  try{
    const study=await business.createStudy(baseParams($('title').value,$('objective').value,$('template').value));
    activeDraft=study; editorQuestions=[];
    renderEditor('manual');
    alertMsg('Draft saved. Add questions, then save again or publish when ready.','success');
  }catch(e){alertMsg(e.message||'Could not create draft.');}
}
async function generateForNewDraft(){
  if(busy)return;
  clearAlert();
  try{
    const params=baseParams($('title').value,$('objective').value,$('template').value);
    const command=$('aiPrompt').value.trim()||params.objective;
    if(command.length<8)throw new Error('Describe the research in at least 8 characters.');
    busy=true;$('generateAI').disabled=true;$('aiStatus').textContent='AI is preparing a survey…';
    const result=await business.generateAiSurvey({command,target_city:params.target_city,sample_size:params.sample_size,reward_per_response_rupees:params.reward_per_response_paise/100,target_min_age:params.target_min_age,target_max_age:params.target_max_age,target_gender:params.target_gender});
    if(!result?.survey?.questions?.length)throw new Error('AI did not return survey questions.');
    const study=await business.createStudy({...params,title:result.survey.title||params.title,objective:result.survey.objective||params.objective,template_type:result.survey.template_type||params.template_type});
    activeDraft=study; editorQuestions=result.survey.questions.slice(0,8).map(normalizeQuestion);
    renderEditor('ai');
    $('aiStatus').textContent='AI draft ready. Review and edit the questions below before saving.';
  }catch(e){alertMsg(e.message||'AI survey generation failed.');$('aiStatus').textContent='';}
  finally{busy=false;$('generateAI').disabled=false;}
}
function normalizeQuestion(q){return {question_text:q.question_text||'',question_type:types.includes(q.question_type)?q.question_type:'short_text',options:Array.isArray(q.options)?q.options.slice():[],is_required:q.is_required!==false};}
function renderEditor(mode){
  const el=$('editor');el.classList.remove('hidden');
  el.innerHTML='<div class="row"><div class="spacer"><p class="eyebrow">'+(mode==='ai'?'AI-GENERATED DRAFT':'MANUAL DRAFT')+'</p><h2>Edit your survey</h2></div><span class="badge amber">Draft</span></div><label for="editTitle">Survey title</label><input id="editTitle" maxlength="120" value="'+esc(activeDraft.title)+'"><label for="editObjective">Research objective</label><textarea id="editObjective" maxlength="500">'+esc(activeDraft.objective||'')+'</textarea><p class="muted">Edit the details and questions below. A survey can contain up to 8 questions.</p><div id="questionEditorList"></div><button class="secondary" id="addQuestionBtn">＋ Add question</button> <button id="saveDraftBtn">Save draft</button> <button class="secondary" id="publishBtn">Publish survey</button>';
  drawQuestionEditors();
  $('addQuestionBtn').addEventListener('click',()=>{if(editorQuestions.length>=8){alertMsg('A survey can have at most 8 questions.');return;}editorQuestions.push({question_text:'',question_type:'short_text',options:[],is_required:true});drawQuestionEditors();});
  $('saveDraftBtn').addEventListener('click',saveQuestions);
  $('publishBtn').addEventListener('click',publishActiveDraft);
}
function drawQuestionEditors(){
 const list=$('questionEditorList');if(!list)return;
 list.innerHTML=editorQuestions.map((q,i)=>'<div class="question-editor"><div class="row"><h3>Question '+(i+1)+'</h3><button class="ghost" data-remove="'+i+'">Remove</button></div><label>Question text</label><input data-qtext="'+i+'" maxlength="300" value="'+esc(q.question_text)+'"><label>Answer type</label><select data-qtype="'+i+'">'+types.map(t=>'<option value="'+t+'" '+(q.question_type===t?'selected':'')+'>'+t.replaceAll('_',' ')+'</option>').join('')+'</select><label>Options (comma-separated for choice questions)</label><input data-qopts="'+i+'" value="'+esc(q.options.join(', '))+'" placeholder="Option A, Option B"></div>').join('')||'<p class="muted">No questions yet. Add one to continue.</p>';
 list.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{editorQuestions.splice(Number(b.dataset.remove),1);drawQuestionEditors();}));
 list.querySelectorAll('[data-qtext]').forEach(el=>el.addEventListener('input',()=>editorQuestions[Number(el.dataset.qtext)].question_text=el.value));
 list.querySelectorAll('[data-qtype]').forEach(el=>el.addEventListener('change',()=>editorQuestions[Number(el.dataset.qtype)].question_type=el.value));
 list.querySelectorAll('[data-qopts]').forEach(el=>el.addEventListener('input',()=>editorQuestions[Number(el.dataset.qopts)].options=el.value.split(',').map(s=>s.trim()).filter(Boolean)));
}
function validatedQuestions(){
 if(!editorQuestions.length||editorQuestions.length>8)throw new Error('Add between 1 and 8 questions.');
 return editorQuestions.map((q,i)=>{
  const text=q.question_text.trim();if(!text)throw new Error('Question '+(i+1)+' needs text.');
  let options=q.options;
  if(['single_choice','multi_choice'].includes(q.question_type)){options=options.filter(Boolean);if(options.length<2)throw new Error('Question '+(i+1)+' needs at least 2 options.');}
  if(q.question_type==='yes_no')options=['Yes','No'];
  return {...q,question_text:text,options};
 });
}
async function saveQuestions(){
 clearAlert();
 try{
  if(!activeDraft)throw new Error('Open a draft first.');
  const qs=validatedQuestions();
  const title=$('editTitle').value.trim(), objective=$('editObjective').value.trim();
  if(!title||!objective)throw new Error('Survey title and objective are required.');
  await business.saveDraft(activeDraft.id,{title,objective,questions:qs});
  activeDraft={...activeDraft,title,objective};editorQuestions=qs;alertMsg('Draft saved. You can continue editing or publish when ready.','success');
  await loadDrafts();
 }catch(e){alertMsg(e.message||'Could not save questions.');}
}
async function loadDrafts(){
 try{
  const studies=await business.listMyStudies();
  const drafts=studies.filter(s=>s.status==='DRAFT');
  $('draftList').innerHTML=drafts.map(s=>'<article class="card draft-row"><div class="draft-main"><h3>'+esc(s.title)+'</h3><p class="muted">'+esc(s.target_city)+' · '+s.sample_size+' target responses · '+esc(s.objective||'No objective')+'</p></div><button class="secondary" data-complete="'+s.id+'">Create survey with AI</button><button data-open="'+s.id+'">Open draft</button></article>').join('')||'<div class="card"><p>No saved drafts yet. Create one in Survey Creation.</p></div>';
  $('draftList').querySelectorAll('[data-complete]').forEach(b=>b.addEventListener('click',()=>completeDraftWithAI(b.dataset.complete)));
  $('draftList').querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openDraft(b.dataset.open)));
 }catch(e){$('draftList').innerHTML='<div class="alert error">'+esc(e.message)+'</div>';}
}
async function openDraft(id){
 try{
  const data=await business.getStudy(id);activeDraft=data.study;
  editorQuestions=data.questions.map(q=>normalizeQuestion({...q,options:q.options.map(o=>o.option_text)}));
  panel('create');renderEditor('manual');alertMsg('Draft opened.','success');
 }catch(e){alertMsg(e.message||'Could not open draft.');}
}
async function completeDraftWithAI(id){
 clearAlert();
 try{
  const data=await business.getStudy(id);
  if(data.questions.length)throw new Error('This draft already has questions. Open it to review, or use a new empty draft for AI completion.');
  const result=await business.generateAiSurvey({command:data.study.objective||data.study.title,target_city:data.study.target_city,sample_size:data.study.sample_size,reward_per_response_rupees:data.study.reward_per_response_paise/100,target_min_age:data.study.target_min_age||18,target_max_age:data.study.target_max_age||65,target_gender:data.study.target_gender||'any'});
  if(!result?.survey?.questions?.length)throw new Error('AI did not return survey questions.');
  activeDraft=data.study;editorQuestions=result.survey.questions.slice(0,8).map(normalizeQuestion);
  panel('create');renderEditor('ai');alertMsg('AI has prepared questions for this draft. Review them before saving.','success');
 }catch(e){alertMsg(e.message||'AI could not complete this draft.');}
}
async function publishActiveDraft(){
 clearAlert();
 try{
  if(!activeDraft)throw new Error('Open a draft first.');
  const qs=validatedQuestions();
  const title=$('editTitle').value.trim(), objective=$('editObjective').value.trim();
  if(!title||!objective)throw new Error('Survey title and objective are required.');
  await business.saveDraft(activeDraft.id,{title,objective,questions:qs});
  await business.publishSurvey(activeDraft.id);
  alertMsg('Survey published successfully. No payment step or admin approval was added.','success');
  activeDraft=null;$('editor').classList.add('hidden');await loadDrafts();panel('results');
 }catch(e){alertMsg(e.message||'Could not publish survey.');}
}
async function loadResults(){
 try{
  const studies=(await business.listMyStudies()).filter(s=>['ACTIVE','COMPLETED','REPORT_READY','ARCHIVED'].includes(s.status));
  $('resultList').innerHTML=studies.map(s=>'<article class="card draft-row"><div class="draft-main"><h3>'+esc(s.title)+'</h3><p class="muted">'+esc(s.target_city)+' · '+esc(s.status)+'</p></div><button data-report="'+s.id+'">View results</button></article>').join('')||'<div class="card"><p>No published surveys yet.</p></div>';
  $('resultList').querySelectorAll('[data-report]').forEach(b=>b.addEventListener('click',()=>showReport(b.dataset.report)));
 }catch(e){$('resultList').innerHTML='<div class="alert error">'+esc(e.message)+'</div>';}
}
async function showReport(id){
 try{
  const r=await business.getStudyReport(id);
  const observed=r.observedResults||{},stats=r.calculatedStatistics||{};
  $('resultDetail').innerHTML='<article class="card"><h2>Results overview</h2><div class="two-col"><div class="question-card"><p class="muted">Total responses</p><h2>'+Number(observed.totalResponses||0)+'</h2></div><div class="question-card"><p class="muted">Valid responses</p><h2>'+Number(observed.validResponses||0)+'</h2></div></div><p>Completion rate: '+Number(stats.completionRatePercent||0)+'% · Valid response rate: '+Number(stats.validResponseRatePercent||0)+'%</p><h3>Question insights</h3>'+(r.questionAnalytics||[]).map(q=>'<div class="question-card"><strong>'+esc(q.questionText)+'</strong>'+(q.breakdown?'<table><tbody>'+q.breakdown.map(x=>'<tr><td>'+esc(x.option)+'</td><td>'+Number(x.count)+'</td><td>'+Number(x.percent??x.percentOfRespondents??0)+'%</td></tr>').join('')+'</tbody></table>':q.average!==undefined?'<p>Average rating: '+esc(q.average??'N/A')+'</p>':'<p class="muted">Not enough structured data for a breakdown yet.</p>')+'</div>').join('')+'</article>';
 }catch(e){alertMsg(e.message||'Could not load results.');}
}
Object.assign(window,{});
init();
