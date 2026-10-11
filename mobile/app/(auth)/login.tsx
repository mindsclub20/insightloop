// mobile/app/(auth)/login.tsx
// WRITTEN, NOT EXECUTED.

import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    // On success, onAuthStateChange in AuthContext fires and _layout.tsx's
    // redirect effect sends the user to the (tabs) group automatically.
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>InsightLoop</Text>
      <Text style={styles.subtitle}>Log in to see research opportunities near you</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
      </Pressable>

      <Link href="/register" style={styles.link}>New here? Create a participant account</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f7f8fa' },
  title: { fontSize: 28, fontWeight: '700', color: '#0b5c56', marginBottom: 4 },
  subtitle: { color: '#6b7280', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 14, marginBottom: 12, backgroundColor: '#fff', fontSize: 16 },
  button: { backgroundColor: '#0f766e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  link: { color: '#0f766e', marginTop: 20, textAlign: 'center' },
});
