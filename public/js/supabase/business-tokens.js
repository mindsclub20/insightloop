import { requireRoleSupabase } from './page-auth.js';
import { supabase } from './client.js';
import { getMyTokenWallet, getMyTokenTransactions, listParticipantAreas, listAreaParticipants, transferTokens, escapeTokenHtml, tokenDate } from './tokens.js';

const money = n => Number(n || 0).toLocaleString('en-IN');
function addPanel() {
  const banner = document.getElementById('verificationBanner');
  const panel = document.createElement('section');
  panel.className = 'card'; panel.id = 'businessTokenPanel';
  panel.innerHTML = `<p class="eyebrow">ANVESH INTERNAL CREDITS</p><h2>Token wallet</h2>
    <p class="muted">Tokens are internal platform credits, not cash. Allocate only from your available balance.</p>
    <div id="businessTokenBalance" style="font:700 30px 'Space Grotesk',sans-serif;color:#5b3ab8">Loading…</div>
    <div id="businessTokenAlert" class="alert hidden" role="status"></div>
    <form id="tokenTransferForm">
      <label for="participantArea">Choose participant area</label>
      <select id="participantArea" required><option value="">Loading areas…</option></select>
      <p class="muted">Participant names and contact details are not shown. Select an area, then choose an anonymous participant account.</p>
      <label for="participantSelect">Participant account</label>
      <select id="participantSelect" required disabled><option value="">Select an area first…</option></select>
      <div class="row"><div style="flex:1;min-width:130px"><label for="tokenTransferAmount">Tokens to allocate</label><input id="tokenTransferAmount" type="number" min="1" max="1000000000" step="1" required></div>
      <div style="flex:2;min-width:180px"><label for="tokenTransferNote">Note (optional)</label><input id="tokenTransferNote" maxlength="500" placeholder="Survey reward"></div></div>
      <button id="tokenTransferButton" type="submit" style="margin-top:12px">Allocate tokens</button>
    </form>
    <h3 style="margin-top:22px">Recent token activity</h3><div id="businessTokenHistory">Loading…</div>`;
  if (banner) banner.after(panel); else document.querySelector('.container')?.prepend(panel);
  return panel;
}
const panel = addPanel();
const $ = id => document.getElementById(id);
function show(message, kind='error') { $('businessTokenAlert').textContent=message; $('businessTokenAlert').className='alert '+kind; }
async function refresh() {
  const [wallet, txs] = await Promise.all([getMyTokenWallet(), getMyTokenTransactions()]);
  $('businessTokenBalance').textContent = money(wallet.balance_tokens) + ' tokens available';
  $('businessTokenHistory').innerHTML = txs.length ? '<table><thead><tr><th>Time</th><th>Direction</th><th>Tokens</th><th>Note</th></tr></thead><tbody>' +
    txs.map(t => '<tr><td>'+escapeTokenHtml(tokenDate(t.created_at))+'</td><td>'+ (t.sender_user_id === wallet.user_id ? 'Sent' : 'Received') +
    '</td><td>'+money(t.amount_tokens)+'</td><td>'+escapeTokenHtml(t.note || t.transaction_type)+'</td></tr>').join('') +
    '</tbody></table>' : '<p class="muted">No token activity yet.</p>';
}
async function loadAreas() {
  const areas = await listParticipantAreas();
  $('participantArea').innerHTML = '<option value="">Choose an area…</option>' + areas.map(a =>
    '<option value="'+escapeTokenHtml(a.area_name)+'">'+escapeTokenHtml(a.area_name)+'</option>').join('');
  if (!areas.length) show('No participant areas are available yet.', 'info');
}
$('participantArea').addEventListener('change', async e => {
  const area = e.currentTarget.value;
  const select = $('participantSelect');
  select.disabled = true;
  select.innerHTML = '<option value="">Loading anonymous accounts…</option>';
  if (!area) {
    select.innerHTML = '<option value="">Select an area first…</option>';
    return;
  }
  try {
    const rows = await listAreaParticipants(area);
    select.innerHTML = '<option value="">Choose an anonymous participant…</option>' + rows.map(p =>
      '<option value="'+escapeTokenHtml(p.user_id)+'">'+escapeTokenHtml(p.participant_label)+'</option>').join('');
    select.disabled = rows.length === 0;
    show(rows.length ? rows.length+' anonymous participant account(s) available in this area.' : 'No participants are available in this area.', rows.length ? 'success' : 'info');
  } catch(error) {
    select.innerHTML = '<option value="">Could not load accounts</option>';
    show(error.message || 'Could not load area participants.');
  }
});
$('tokenTransferForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=$('tokenTransferButton'); btn.disabled=true; btn.textContent='Allocating…';
  try {
    const target=$('participantSelect').value;
    if(!$('participantArea').value) throw new Error('Choose an area first.');
    if(!target) throw new Error('Choose an anonymous participant account.');
    const amount=Number($('tokenTransferAmount').value);
    if(!Number.isSafeInteger(amount)||amount<1) throw new Error('Enter a positive whole number of tokens.');
    await transferTokens(target, amount, $('tokenTransferNote').value);
    $('tokenTransferAmount').value=''; $('tokenTransferNote').value='';
    show('Tokens allocated successfully and recorded in the ledger.','success'); await refresh();
  } catch(error) { show(error.message || 'Token allocation failed.'); }
  finally { btn.disabled=false; btn.textContent='Allocate tokens'; }
});
async function startBusinessTokenPanel() {
  try {
    const { data: { session: authSession }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!authSession) { panel.classList.add('hidden'); return; }
    const session = await requireRoleSupabase('BUSINESS');
    if (session) {
      await Promise.all([refresh(), loadAreas()]);
    }
  } catch (error) { show(error.message || 'Token wallet could not load.'); }
}
startBusinessTokenPanel();
