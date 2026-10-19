import { requireRoleSupabase } from './page-auth.js';
import { supabase } from './client.js';
import { getMyTokenWallet, getMyTokenTransactions, searchTokenParticipants, transferTokens, escapeTokenHtml, tokenDate } from './tokens.js';

const money = n => Number(n || 0).toLocaleString('en-IN');
function addPanel() {
  const banner = document.getElementById('verificationBanner');
  const panel = document.createElement('section');
  panel.className = 'card'; panel.id = 'businessTokenPanel';
  panel.innerHTML = `<p class="eyebrow">ANVESH INTERNAL CREDITS</p><h2>🪙 Token wallet</h2>
    <p class="muted">Tokens are internal platform credits, not cash. Allocate only from your available balance.</p>
    <div id="businessTokenBalance" style="font:700 30px 'Space Grotesk',sans-serif;color:#5b3ab8">Loading…</div>
    <div id="businessTokenAlert" class="alert hidden" role="status"></div>
    <form id="participantSearchForm"><label for="participantSearch">Find a participant by name</label>
      <div class="row"><input id="participantSearch" maxlength="80" placeholder="Enter participant name" style="flex:1;min-width:180px"><button class="secondary" type="submit">Search</button></div></form>
    <form id="tokenTransferForm"><label for="participantSelect">Participant</label><select id="participantSelect" required><option value="">Search participants first…</option></select>
      <div class="row"><div style="flex:1;min-width:130px"><label for="tokenTransferAmount">Tokens to allocate</label><input id="tokenTransferAmount" type="number" min="1" max="1000000000" step="1" required></div>
      <div style="flex:2;min-width:180px"><label for="tokenTransferNote">Note (optional)</label><input id="tokenTransferNote" maxlength="500" placeholder="Survey pilot reward"></div></div>
      <button id="tokenTransferButton" type="submit" style="margin-top:12px">Allocate tokens</button></form>
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
$('participantSearchForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=e.currentTarget.querySelector('button'); btn.disabled=true;
  try {
    const rows=await searchTokenParticipants($('participantSearch').value);
    $('participantSelect').innerHTML='<option value="">Choose a participant…</option>'+rows.map(p =>
      '<option value="'+escapeTokenHtml(p.user_id)+'">'+escapeTokenHtml(p.full_name || 'Participant')+
      (p.city ? ' · '+escapeTokenHtml(p.city) : '')+'</option>').join('');
    show(rows.length ? rows.length+' participant account(s) found.' : 'No matching participants found.', rows.length ? 'success' : 'info');
  } catch(error) { show(error.message || 'Participant search failed.'); }
  finally { btn.disabled=false; }
});
$('tokenTransferForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=$('tokenTransferButton'); btn.disabled=true; btn.textContent='Allocating…';
  try {
    const target=$('participantSelect').value;
    if(!target) throw new Error('Search for and select a participant first.');
    const amount=Number($('tokenTransferAmount').value);
    if(!Number.isSafeInteger(amount)||amount<1) throw new Error('Enter a positive whole number of tokens.');
    await transferTokens(target, amount, $('tokenTransferNote').value);
    $('tokenTransferAmount').value=''; $('tokenTransferNote').value='';
    show('Tokens allocated successfully and recorded in the ledger.','success'); await refresh();
  } catch(error) { show(error.message || 'Token allocation failed.'); }
  finally { btn.disabled=false; btn.textContent='Allocate tokens'; }
});
const session = await requireRoleSupabase('BUSINESS');
if(session) {
  try {
    const {data:{user}}=await supabase.auth.getUser();
    if(!user) throw new Error('Please sign in again.');
    await refresh();
  } catch(error) { show(error.message || 'Token wallet could not load.'); }
}
