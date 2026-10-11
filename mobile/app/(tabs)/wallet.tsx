// mobile/app/(tabs)/wallet.tsx
//
// WRITTEN, NOT EXECUTED. Balance/transactions are direct RLS reads (RLS
// policies "own wallet read" / "own transactions read", 002). Withdrawal
// submission goes through the request-withdrawal Edge Function, which
// itself calls the request_withdrawal() RPC using the CALLER's own client -
// see that function's header comment for why this is the one write in the
// whole app that deliberately exercises the "RLS is the boundary" model
// instead of "Edge Function as trusted backend".

import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';

interface Wallet { balance_paise: number; pending_paise: number; }
interface Transaction { id: string; type: string; amount_paise: number; status: string; created_at: string; }

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function WalletScreen() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: w, error: walletErr } = await supabase.from('wallets').select('id, balance_paise, pending_paise').eq('user_id', user.id).single();
    if (walletErr) { setError(walletErr.message); setLoading(false); return; }
    setWallet(w);

    const { data: txs, error: txErr } = await supabase.from('wallet_transactions').select('id, type, amount_paise, status, created_at')
      .eq('wallet_id', w.id).order('created_at', { ascending: false }).limit(50);
    if (txErr) { setError(txErr.message); setLoading(false); return; }
    setTransactions(txs ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function requestWithdrawal() {
    const amountPaise = Math.round(parseFloat(amount) * 100);
    if (!amountPaise || amountPaise < 10000) { Alert.alert('Minimum withdrawal is ₹100'); return; }
    if (!upiId) { Alert.alert('Enter a UPI ID'); return; }

    setSubmitting(true);
    const { error } = await supabase.functions.invoke('request-withdrawal', { body: { amount_paise: amountPaise, upi_id: upiId } });
    setSubmitting(false);
    if (error) { Alert.alert('Withdrawal failed', error.message); return; }
    Alert.alert('Withdrawal requested', 'An admin will process it manually — see the demo notice for what "manual" means in this build.');
    setAmount(''); setUpiId('');
    load();
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load your wallet right now.</Text>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}><Text style={styles.retryText}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={transactions}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={
        <View>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceAmount}>{rupees(wallet?.balance_paise ?? 0)}</Text>
            <Text style={styles.muted}>Pending: {rupees(wallet?.pending_paise ?? 0)}</Text>
          </View>

          <View style={styles.withdrawCard}>
            <Text style={styles.sectionTitle}>Request withdrawal</Text>
            <TextInput style={styles.input} placeholder="Amount (₹, min 100)" keyboardType="numeric" value={amount} onChangeText={setAmount} />
            <TextInput style={styles.input} placeholder="UPI ID" autoCapitalize="none" value={upiId} onChangeText={setUpiId} />
            <Pressable style={styles.button} onPress={requestWithdrawal} disabled={submitting}>
              <Text style={styles.buttonText}>{submitting ? 'Submitting...' : 'Request withdrawal'}</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Transaction history</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.txRow}>
          <Text style={styles.txType}>{item.type}</Text>
          <Text style={item.amount_paise >= 0 ? styles.txAmountPositive : styles.txAmountNegative}>{rupees(item.amount_paise)}</Text>
          <Text style={styles.txStatus}>{item.status}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.muted}>No transactions yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, backgroundColor: '#f7f8fa' },
  balanceCard: { backgroundColor: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  balanceLabel: { color: '#6b7280', marginBottom: 4 },
  balanceAmount: { fontSize: 32, fontWeight: '700', color: '#16a34a' },
  withdrawCard: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10, backgroundColor: '#fff' },
  button: { backgroundColor: '#0f766e', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  txType: { flex: 1 },
  txAmountPositive: { color: '#16a34a', fontWeight: '600' },
  txAmountNegative: { color: '#dc2626', fontWeight: '600' },
  txStatus: { color: '#6b7280', marginLeft: 10 },
  muted: { color: '#6b7280' },
  errorText: { color: '#dc2626', fontWeight: '600', marginBottom: 4, textAlign: 'center' },
  retryButton: { backgroundColor: '#0f766e', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 14 },
  retryText: { color: '#fff', fontWeight: '600' },
});
