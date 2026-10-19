import { supabase } from './client.js';
import { requireRoleSupabase, logoutSupabase } from './page-auth.js';
import { adminListTokenAccounts, adminListTokenTransactions, adminGrantTokens, escapeTokenHtml, tokenDate } from './tokens.js';

const $ = (id) => document.getElementById(id);
let accounts = [];
function alertBox(message, kind = 'error') {
  const el = $('tokenAlert'); el.textContent = message; el.className = 'alert ' + kind;
}
function clearAlert() { $('tokenAlert').textContent = ''; $('tokenAlert').className = 'alert hidden'; }
function balance(v) { return Number(v || 0).toLocaleString('en-IN'); }

async function load() {
  clearAlert();
  $('tokenAccounts').textContent = 'Loading…';
  $('tokenTransactions').textContent = 'Loading…';
  try {
    [accounts, window.__tokenTransactions] = await Promise.all([adminListTokenAccounts(), adminListTokenTransactions()]);
    const businesses = accounts.filter(a => a.role === 'BUSINESS');
    $('businessSelect').innerHTML = '<option value="">Choose a business…</option>' + businesses.map(b =>
      '<option value="' + escapeTokenHtml(b.user_id) + '">' + escapeTokenHtml(b.business_name || b.full_name || 'Business') +
      ' · ' + escapeTokenHtml(b.full_name || 'Account') + ' · ' + balance(b.balance_tokens) + ' tokens</option>'
    ).join('');
    const total = accounts.reduce((sum, a) => sum + Number(a.balance_tokens || 0), 0);
    $('tokenStats').textContent = balance(total) + ' tokens across ' + accounts.length + ' accounts';
    $('tokenAccounts').innerHTML = accounts.length ? '<table><thead><tr><th>Account</th><th>Type</th><th>Balance</th><th>Created</th></tr></thead><tbody>' +
      accounts.map(a => '<tr><td>' + escapeTokenHtml(a.business_name || a.full_name || 'Unnamed account') +
      '<br><small class="muted">' + escapeTokenHtml(a.full_name || '') + '</small></td><td>' + escapeTokenHtml(a.role) +
      '</td><td><strong>' + balance(a.balance_tokens) + '</strong></td><td>' + escapeTokenHtml(new Date(a.created_at).toLocaleDateString()) +
      '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No accounts found.</p>';
    const byId = new Map(accounts.map(a => [a.user_id, a]));
    const txs = window.__tokenTransactions || [];
    $('tokenTransactions').innerHTML = txs.length ? '<table><thead><tr><th>When</th><th>From</th><th>To</th><th>Amount</th><th>Type</th><th>Note</th></tr></thead><tbody>' +
      txs.map(t => '<tr><td>' + escapeTokenHtml(tokenDate(t.created_at)) + '</td><td>' +
      escapeTokenHtml(t.sender_user_id ? (byId.get(t.sender_user_id)?.business_name || byId.get(t.sender_user_id)?.full_name || 'Account') : 'Anvesh Admin') +
      '</td><td>' + escapeTokenHtml(byId.get(t.recipient_user_id)?.business_name || byId.get(t.recipient_user_id)?.full_name || 'Account') +
      '</td><td><strong>' + balance(t.amount_tokens) + '</strong></td><td>' + escapeTokenHtml(t.transaction_type) +
      '</td><td>' + escapeTokenHtml(t.note || '—') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No token transactions yet.</p>';
  } catch (error) {
    alertBox(error.message || 'Could not load token accounts.');
    $('tokenAccounts').textContent = 'Token account data unavailable.';
    $('tokenTransactions').textContent = 'Transaction data unavailable.';
  }
}

$('grantForm').addEventListener('submit', async (event) => {
  event.preventDefault(); clearAlert();
  const button = $('grantButton'); button.disabled = true; button.textContent = 'Granting…';
  try {
    const id = $('businessSelect').value;
    if (!id) throw new Error('Choose a business account first.');
    const amount = Number($('grantAmount').value);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Enter a positive whole number of tokens.');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Please sign in again.');
    await adminGrantTokens(id, amount, $('grantNote').value);
    $('grantAmount').value = ''; $('grantNote').value = '';
    alertBox('Tokens granted and recorded in the ledger.', 'success');
    await load();
  } catch (error) { alertBox(error.message || 'Token grant failed.'); }
  finally { button.disabled = false; button.textContent = 'Grant tokens'; }
});
$('refreshTokens').addEventListener('click', load);
$('logoutLink').addEventListener('click', async (e) => { e.preventDefault(); await logoutSupabase(); });
const session = await requireRoleSupabase('ADMIN');
if (session) { $('userName').textContent = session.profile.full_name || session.user.email; await load(); }
