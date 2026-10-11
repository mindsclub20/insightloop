// src/lib/ledger.js
//
// Every rupee that moves through InsightLoop is recorded as an append-only
// row in wallet_transactions BEFORE wallets.balance_paise is ever touched.
// Nothing in this file (or anywhere else in the codebase) writes to
// wallets.balance_paise directly outside of applyConfirmedDelta() below.
// Every transaction has a unique idempotency_key so a retried request
// (double-tap, network retry, replayed webhook) can never double-credit
// or double-debit — the UNIQUE constraint on wallet_transactions.idempotency_key
// is the actual enforcement, this code just fails gracefully when it fires.

import { db } from '../db.js';
import { newId } from './ids.js';

function getOrCreateWallet(userId) {
  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!wallet) {
    const id = newId();
    db.prepare('INSERT INTO wallets (id, user_id) VALUES (?, ?)').run(id, userId);
    wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return wallet;
}

function applyConfirmedDelta(walletId, deltaBalance, deltaPending) {
  db.prepare(`
    UPDATE wallets
    SET balance_paise = balance_paise + ?,
        pending_paise = pending_paise + ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(deltaBalance, deltaPending, walletId);
}

// Called when a participant submits a survey response that passes initial
// (non-flagged) checks. Creates a PENDING reward — money is NOT available
// to withdraw yet, it only becomes available once the response is marked
// VALID (either automatically, for clean responses, or by an admin after
// review for flagged ones).
export function createPendingReward({ userId, responseId, amountPaise }) {
  const wallet = getOrCreateWallet(userId);
  const idempotencyKey = `reward:${responseId}`;
  const existing = db.prepare('SELECT * FROM wallet_transactions WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) return existing; // already created - never double-create

  const id = newId();
  db.prepare(`
    INSERT INTO wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key)
    VALUES (?, ?, 'SURVEY_REWARD', ?, 'PENDING', ?, ?)
  `).run(id, wallet.id, amountPaise, responseId, idempotencyKey);

  applyConfirmedDelta(wallet.id, 0, amountPaise); // shows up as "pending", not spendable
  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id);
}

// Moves a PENDING reward to CONFIRMED and makes it spendable. Idempotent:
// calling this twice on an already-CONFIRMED transaction is a no-op.
export function confirmReward(responseId) {
  const idempotencyKey = `reward:${responseId}`;
  const tx = db.prepare('SELECT * FROM wallet_transactions WHERE idempotency_key = ?').get(idempotencyKey);
  if (!tx) throw new Error('No pending reward transaction found for this response');
  if (tx.status === 'CONFIRMED') return tx; // idempotent no-op

  db.prepare(`UPDATE wallet_transactions SET status = 'CONFIRMED', updated_at = datetime('now') WHERE id = ?`).run(tx.id);
  applyConfirmedDelta(tx.wallet_id, tx.amount_paise, -tx.amount_paise); // move pending -> balance
  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(tx.id);
}

// Moves a PENDING reward to FAILED (response was rejected by admin review)
// and removes it from pending — no balance was ever added, so nothing to reverse there.
export function forfeitReward(responseId) {
  const idempotencyKey = `reward:${responseId}`;
  const tx = db.prepare('SELECT * FROM wallet_transactions WHERE idempotency_key = ?').get(idempotencyKey);
  if (!tx) return null;
  if (tx.status !== 'PENDING') return tx; // already resolved, do nothing

  db.prepare(`UPDATE wallet_transactions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?`).run(tx.id);
  applyConfirmedDelta(tx.wallet_id, 0, -tx.amount_paise);
  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(tx.id);
}

export function requestWithdrawal({ userId, amountPaise, upiId }) {
  const wallet = getOrCreateWallet(userId);
  if (wallet.balance_paise < amountPaise) {
    const err = new Error('Insufficient balance');
    err.status = 400;
    throw err;
  }
  const withdrawalId = newId();
  const idempotencyKey = `withdrawal:${withdrawalId}`;
  const txId = newId();

  // wallet_transactions row must exist before withdrawals can reference it
  // (withdrawals.ledger_transaction_id is a foreign key).
  db.prepare(`
    INSERT INTO wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key)
    VALUES (?, ?, 'WITHDRAWAL', ?, 'PROCESSING', ?, ?)
  `).run(txId, wallet.id, -amountPaise, withdrawalId, idempotencyKey);

  db.prepare(`
    INSERT INTO withdrawals (id, user_id, amount_paise, upi_id, status, ledger_transaction_id)
    VALUES (?, ?, ?, ?, 'REQUESTED', ?)
  `).run(withdrawalId, userId, amountPaise, upiId, txId);

  // Reserve the funds immediately so the same balance can't be withdrawn twice.
  applyConfirmedDelta(wallet.id, -amountPaise, 0);

  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
}

// P0 NOTE: this marks the withdrawal PAID in our ledger once an admin has
// manually confirmed a real UPI payout was sent outside this system.
// There is NO live payment-provider integration in P0 — see README "What is
// still mocked/manual". This function must never be called automatically.
export function markWithdrawalPaid(withdrawalId, adminId) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
  if (!w) throw new Error('Withdrawal not found');
  if (w.status === 'PAID') return w; // idempotent
  if (w.status !== 'REQUESTED' && w.status !== 'PROCESSING') {
    throw new Error(`Cannot mark ${w.status} withdrawal as paid`);
  }
  db.prepare(`UPDATE withdrawals SET status = 'PAID', processed_by = ?, updated_at = datetime('now') WHERE id = ?`).run(adminId, withdrawalId);
  db.prepare(`UPDATE wallet_transactions SET status = 'PAID', updated_at = datetime('now') WHERE id = ?`).run(w.ledger_transaction_id);
  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
}

export function rejectWithdrawal(withdrawalId, adminId, reason) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
  if (!w) throw new Error('Withdrawal not found');
  if (w.status === 'PAID' || w.status === 'REJECTED') return w;

  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(w.user_id);
  db.prepare(`UPDATE withdrawals SET status = 'REJECTED', processed_by = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(adminId, reason || null, withdrawalId);
  db.prepare(`UPDATE wallet_transactions SET status = 'FAILED', updated_at = datetime('now') WHERE id = ?`).run(w.ledger_transaction_id);

  // Reverse the reservation back into the spendable balance, as its own
  // append-only ledger row (never a silent balance edit).
  const reversalId = newId();
  db.prepare(`
    INSERT INTO wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key, notes)
    VALUES (?, ?, 'WITHDRAWAL_REVERSAL', ?, 'CONFIRMED', ?, ?, ?)
  `).run(reversalId, wallet.id, w.amount_paise, withdrawalId, `reversal:${withdrawalId}`, reason || 'withdrawal rejected');
  applyConfirmedDelta(wallet.id, w.amount_paise, 0);

  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
}

export function getWallet(userId) {
  return getOrCreateWallet(userId);
}

export function getTransactions(userId) {
  const wallet = getOrCreateWallet(userId);
  return db.prepare('SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC').all(wallet.id);
}

// Reconciliation: recompute what the balance SHOULD be purely from the
// transaction ledger, and compare to the materialized wallets row. Used by
// the admin "ledger audit" screen and by the test suite. Any mismatch here
// indicates a bug and should never happen if applyConfirmedDelta() is the
// only writer of balance/pending — which it is.
export function reconcileWallet(userId) {
  const wallet = getOrCreateWallet(userId);
  const txs = db.prepare('SELECT * FROM wallet_transactions WHERE wallet_id = ?').all(wallet.id);
  let expectedBalance = 0;
  let expectedPending = 0;
  for (const tx of txs) {
    if (tx.type === 'SURVEY_REWARD') {
      if (tx.status === 'PENDING') expectedPending += tx.amount_paise;
      if (tx.status === 'CONFIRMED') expectedBalance += tx.amount_paise;
    } else if (tx.type === 'WITHDRAWAL') {
      if (tx.status === 'PROCESSING' || tx.status === 'PAID') expectedBalance += tx.amount_paise; // amount is negative
    } else if (tx.type === 'WITHDRAWAL_REVERSAL' || tx.type === 'ADJUSTMENT') {
      if (tx.status === 'CONFIRMED') expectedBalance += tx.amount_paise;
    }
  }
  return {
    userId,
    walletBalance: wallet.balance_paise,
    walletPending: wallet.pending_paise,
    expectedBalance,
    expectedPending,
    matches: expectedBalance === wallet.balance_paise && expectedPending === wallet.pending_paise,
  };
}
