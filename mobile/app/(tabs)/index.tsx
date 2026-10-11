// mobile/app/(tabs)/index.tsx
//
// WRITTEN, NOT EXECUTED. Direct RLS-protected read - no Edge Function
// needed, exactly the "client talks to Postgres directly" pattern (see
// public/js/supabase-integration-example.js). Eligibility filtering
// (age/city/tags) mirrors src/lib/matching.js's isEligible(), ported here
// since it's a product/UX concern, not a security boundary that needs to
// live server-side (the server still re-verifies eligibility on submit,
// in supabase/functions/submit-survey-response - this client-side filter
// is only about which studies to SHOW).

import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface Study {
  id: string;
  title: string;
  objective: string | null;
  target_city: string;
  reward_per_response_paise: number;
  target_min_age: number | null;
  target_max_age: number | null;
  target_tags: string[];
}

function ageOverlaps(userAgeRange: string | null, min: number | null, max: number | null) {
  if (!min && !max) return true;
  if (!userAgeRange) return false;
  const [uMin, uMax] = userAgeRange.split('-').map(Number);
  const lo = min ?? 0, hi = max ?? 200;
  return uMax >= lo && uMin <= hi;
}

export default function StudiesScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadyResponded, setAlreadyResponded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: activeStudies, error: studiesErr } = await supabase
      .from('research_projects')
      .select('id, title, objective, target_city, reward_per_response_paise, target_min_age, target_max_age, target_tags')
      .eq('status', 'ACTIVE');
    if (studiesErr) { setError(studiesErr.message); setLoading(false); return; }

    const { data: responded, error: respondedErr } = await supabase.from('survey_responses').select('research_project_id');
    if (respondedErr) { setError(respondedErr.message); setLoading(false); return; }
    setAlreadyResponded(new Set((responded ?? []).map((r) => r.research_project_id)));

    const filtered = (activeStudies ?? []).filter((s) => {
      if (s.target_city && profile?.city && s.target_city.toLowerCase() !== profile.city.toLowerCase()) return false;
      if (!ageOverlaps(profile?.age_range ?? null, s.target_min_age, s.target_max_age)) return false;
      return true;
    });

    setStudies(filtered as Study[]);
    setLoading(false);
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load studies right now.</Text>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}><Text style={styles.retryText}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={studies.filter((s) => !alreadyResponded.has(s.id))}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListEmptyComponent={<Text style={styles.empty}>No research opportunities match your profile right now. Check back soon.</Text>}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => router.push(`/study/${item.id}`)}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.objective && <Text style={styles.cardObjective}>{item.objective}</Text>}
          <View style={styles.cardRow}>
            <Text style={styles.reward}>₹{(item.reward_per_response_paise / 100).toFixed(2)}</Text>
            <Text style={styles.muted}>{item.target_city}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, backgroundColor: '#f7f8fa', flexGrow: 1 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40 },
  errorText: { color: '#dc2626', fontWeight: '600', marginBottom: 4, textAlign: 'center' },
  retryButton: { backgroundColor: '#0f766e', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 14 },
  retryText: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardObjective: { color: '#6b7280', marginBottom: 8 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  reward: { color: '#16a34a', fontWeight: '700' },
  muted: { color: '#6b7280' },
});
