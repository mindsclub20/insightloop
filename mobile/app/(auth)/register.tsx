// mobile/app/(auth)/register.tsx
// WRITTEN, NOT EXECUTED. Participant registration only - business/admin
// accounts are web-first by design (see mobile/README.md "Why participant-only").

import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

const MIN_AGE = 18;

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState(''); // YYYY-MM-DD text input for simplicity; swap for a native date picker in a real build
  const [city, setCity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function isAdult(dobString: string): boolean {
    const d = new Date(dobString);
    if (Number.isNaN(d.getTime())) return false;
    const age = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return age >= MIN_AGE;
  }

  async function handleRegister() {
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    // CLIENT-SIDE CHECK ONLY - defense in depth, matching the "reframe is
    // the signal to refuse" caution around age claims generally: a modified
    // client could skip this. The real enforcement belongs in the
    // handle_new_user() database trigger (docs/SUPABASE_SETUP.md), which
    // should reject the signup server-side if date_of_birth in the user's
    // metadata indicates under 18 - not yet written as of this pass, listed
    // as a gap below.
    if (!isAdult(dob)) { setError('InsightLoop is currently restricted to participants aged 18 and over'); return; }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      // account_type/date_of_birth are read by the handle_new_user()
      // trigger (migrations/008_auth_trigger.sql), which is what actually
      // decides the row's role and enforces the 18+ gate server-side - this
      // client only sends data, it never sends (or could usefully lie
      // about) a role.
      options: { data: { full_name: fullName, city, date_of_birth: dob, account_type: 'participant' } },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.replace('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>18+ only. We only ask for what's needed to match you to relevant research.</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <TextInput style={styles.input} placeholder="Full name" value={fullName} onChangeText={setFullName} />
      <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password (min 8 characters)" secureTextEntry value={password} onChangeText={setPassword} />
      <TextInput style={styles.input} placeholder="Date of birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} />
      <TextInput style={styles.input} placeholder="City" value={city} onChangeText={setCity} />

      <Pressable style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating account...' : 'Create account'}</Text>
      </Pressable>

      <Link href="/login" style={styles.link}>Already have an account? Log in</Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f7f8fa' },
  title: { fontSize: 24, fontWeight: '700', color: '#0b5c56', marginBottom: 4 },
  subtitle: { color: '#6b7280', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 14, marginBottom: 12, backgroundColor: '#fff', fontSize: 16 },
  button: { backgroundColor: '#0f766e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  link: { color: '#0f766e', marginTop: 20, textAlign: 'center' },
});
