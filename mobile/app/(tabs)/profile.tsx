// mobile/app/(tabs)/profile.tsx
// WRITTEN, NOT EXECUTED. Update is RLS policy "own profile update" (002).

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const [city, setCity] = useState('');
  const [ageRange, setAgeRange] = useState('18-25');
  const [saving, setSaving] = useState(false);

  // BUG FIX: `profile` loads asynchronously in AuthContext (fetched after
  // the session resolves, in a separate effect) - if this screen mounted
  // before that fetch completed, seeding local state via useState(profile
  // ?.city ?? '') directly would have locked the fields at blank/default
  // FOREVER, since useState's initial value is only read on first render.
  // Worse: hitting Save in that window would have silently overwritten the
  // user's real city/age_range with those blank/default values. This
  // effect syncs local state once real profile data actually arrives, and
  // the `initialized` ref stops it from re-firing on every profile object
  // change afterwards, which would otherwise clobber in-progress edits.
  const initialized = useRef(false);
  useEffect(() => {
    if (profile && !initialized.current) {
      setCity(profile.city ?? '');
      setAgeRange(profile.age_range ?? '18-25');
      initialized.current = true;
    }
  }, [profile]);

  async function save() {
    if (!session?.user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ city, age_range: ageRange }).eq('id', session.user.id);
    setSaving(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    Alert.alert('Profile updated');
  }

  if (!profile) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.name}>{profile?.full_name ?? 'Participant'}</Text>
      <Text style={styles.muted}>{session?.user?.email}</Text>

      <Text style={styles.label}>City</Text>
      <TextInput style={styles.input} value={city} onChangeText={setCity} />

      <Text style={styles.label}>Age range</Text>
      <TextInput style={styles.input} value={ageRange} onChangeText={setAgeRange} placeholder="e.g. 18-25" />

      <Pressable style={styles.button} onPress={save} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save changes'}</Text>
      </Pressable>

      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Log out</Text>
      </Pressable>

      <Text style={styles.demoNotice}>
        Demo build — account deletion/data-export requests are not yet wired to a real flow; see the project README's
        legal/compliance notes.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, backgroundColor: '#f7f8fa', flexGrow: 1 },
  name: { fontSize: 20, fontWeight: '700' },
  muted: { color: '#6b7280', marginBottom: 20 },
  label: { fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 12, backgroundColor: '#fff' },
  button: { backgroundColor: '#0f766e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontWeight: '600' },
  signOutButton: { borderWidth: 1, borderColor: '#dc2626', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  signOutText: { color: '#dc2626', fontWeight: '600' },
  demoNotice: { color: '#6b7280', fontSize: 12, marginTop: 30, textAlign: 'center' },
});
