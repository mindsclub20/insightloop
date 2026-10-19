import { requireRoleSupabase } from './page-auth.js';
import { supabase } from './client.js';
import { getMyTokenWallet, getMyTokenTransactions, escapeTokenHtml, tokenDate } from './tokens.js';

async function startParticipantTokenPanel() {
  try {
    const { data: { session: authSession }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!authSession) return;
    const session = await requireRoleSupabase('USER');
    if (!session) return;
    const container = document.querySelector('.container');
    const card = document.createElement('section');
    card.className = 'card'; card.style.marginTop = '20px';
    card.innerHTML = '<p class="eyebrow">ANVESH INTERNAL CREDITS</p><h2>🪙 Your token wallet</h2>' +
      '<p class="muted">Tokens are internal platform credits, not cash or a promise of payment.</p>' +
      '<div id="participantTokenBalance" style="font:700 30px Space Grotesk,sans-serif;color:#5b3ab8">Loading…</div>' +
      '<div id="participantTokenHistory">Loading token history…</div>';
    container?.append(card);
    try {
      const [wallet, txs] = await Promise.all([getMyTokenWallet(), getMyTokenTransactions()]);
      document.getElementById('participantTokenBalance').textContent = Number(wallet.balance_tokens || 0).toLocaleString('en-IN') + ' tokens';
      document.getElementById('participantTokenHistory').innerHTML = txs.length
        ? '<h3 style="margin-top:18px">Recent activity</h3><table><thead><tr><th>Time</th><th>Activity</th><th>Tokens</th><th>Note</th></tr></thead><tbody>' +
          txs.map(t => '<tr><td>'+escapeTokenHtml(tokenDate(t.created_at))+'</td><td>'+(t.recipient_user_id === wallet.user_id ? 'Received' : 'Sent')+
            '</td><td>'+Number(t.amount_tokens).toLocaleString('en-IN')+'</td><td>'+escapeTokenHtml(t.note || t.transaction_type)+'</td></tr>').join('')+
          '</tbody></table>'
        : '<p class="muted">No token activity yet.</p>';
    } catch (error) {
      document.getElementById('participantTokenBalance').textContent = 'Balance unavailable';
      document.getElementById('participantTokenHistory').textContent = error.message || 'Could not load token history.';
    }
  } catch (error) { console.error('Token panel auth check failed:', error); }
}
startParticipantTokenPanel();
