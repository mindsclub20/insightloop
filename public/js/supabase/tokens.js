// Anvesh internal-token ledger client. Tokens are not cash and cannot be withdrawn.
import { supabase } from './client.js';

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Token request failed.');
  return data;
}

export async function getMyTokenWallet() {
  const rows = await rpc('get_my_token_wallet');
  return rows?.[0] ?? { user_id: null, balance_tokens: 0 };
}
export async function getMyTokenTransactions() {
  return (await rpc('get_my_token_transactions')) ?? [];
}
export async function adminListTokenAccounts() {
  return (await rpc('admin_list_token_accounts')) ?? [];
}
export async function adminListTokenTransactions() {
  return (await rpc('admin_list_token_transactions')) ?? [];
}
export async function adminGrantTokens(userId, amount, note = '') {
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000_000) throw new Error('Enter a whole number from 1 to 1,000,000,000.');
  return rpc('admin_grant_tokens', {
    p_business_user_id: userId,
    p_amount_tokens: n,
    p_idempotency_key: crypto.randomUUID(),
    p_note: note.trim().slice(0, 500) || null,
  });
}
export async function listParticipantAreas() {
  return (await rpc('business_list_participant_areas')) ?? [];
}
export async function listAreaParticipants(area) {
  if (!area) return [];
  return (await rpc('business_list_area_participants', { p_area: area })) ?? [];
}
export async function transferTokens(participantId, amount, note = '') {
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000_000) throw new Error('Enter a whole number from 1 to 1,000,000,000.');
  return rpc('business_transfer_tokens', {
    p_participant_user_id: participantId,
    p_amount_tokens: n,
    p_idempotency_key: crypto.randomUUID(),
    p_note: note.trim().slice(0, 500) || null,
  });
}
export function escapeTokenHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[c]);
}
export function tokenDate(value) {
  return new Date(value).toLocaleString();
}
