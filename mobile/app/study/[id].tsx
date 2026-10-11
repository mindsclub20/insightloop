// mobile/app/study/[id].tsx
//
// WRITTEN, NOT EXECUTED. Study/question read is direct-RLS (policies on
// research_projects/survey_questions/question_options, 002+004). Submission
// goes through the submit-survey-response Edge Function, which re-verifies
// eligibility, status, and runs fraud evaluation server-side regardless of
// what this screen already checked - exactly mirroring
// src/routes/participant.js's submitStudy() and public/js/participant.js's
// survey-taking flow, just as native screens instead of DOM manipulation.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  is_required: boolean;
  options: { id: string; option_text: string }[];
}

type Answer = { question_id: string; selected_option_ids?: string[]; text_answer?: string; rating_value?: number };

export default function StudyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [study, setStudy] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [alreadyResponded, setAlreadyResponded] = useState<{ status: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [startedAt] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);

      // .maybeSingle() (not .single()) is deliberate: if RLS filters this
      // row out entirely (study isn't ACTIVE and this participant has no
      // response for it - the same IDOR case fixed in
      // src/routes/participant.js's getStudyDetails during the route
      // audit), Postgres returns zero rows, which .single() would treat as
      // an error rather than the "not found" state this screen needs to
      // show. There is no separate eligibility/ownership check to get
      // wrong here the way there was in the original Node bug - RLS policy
      // "participants read active projects" (002) is the entire boundary.
      const { data: s, error: studyErr } = await supabase.from('research_projects').select('*').eq('id', id).maybeSingle();
      if (studyErr) { setLoadError(studyErr.message); setLoading(false); return; }
      if (!s) { setStudy(null); setLoading(false); return; } // not found / not visible - rendered below, not an error state

      setStudy(s);

      const { data: { user } } = await supabase.auth.getUser();
      const { data: existingResponse } = await supabase.from('survey_responses')
        .select('status').eq('research_project_id', id).eq('user_id', user?.id).maybeSingle();
      if (existingResponse) {
        setAlreadyResponded(existingResponse);
        setLoading(false);
        return; // don't bother loading questions for a study already completed
      }

      const { data: qs, error: qErr } = await supabase.from('survey_questions').select('*').eq('research_project_id', id).order('order_index');
      if (qErr) { setLoadError(qErr.message); setLoading(false); return; }

      const withOptions = await Promise.all((qs ?? []).map(async (q) => {
        const { data: opts } = await supabase.from('question_options').select('id, option_text').eq('question_id', q.id).order('order_index');
        return { ...q, options: opts ?? [] };
      }));
      setQuestions(withOptions as Question[]);
      setLoading(false);
    })();
  }, [id]);

  function recordAnswer(a: Answer) {
    setAnswers((prev) => ({ ...prev, [a.question_id]: a }));
    setIndex((i) => i + 1);
  }

  async function submit() {
    setSubmitting(true);
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    const { data, error } = await supabase.functions.invoke('submit-survey-response', {
      body: {
        research_project_id: id,
        answers: Object.values(answers),
        duration_seconds: durationSeconds,
        device_fingerprint: 'expo-device', // replace with expo-application's getAndroidId() or a stored UUID in a real build
      },
    });
    setSubmitting(false);
    if (error) { Alert.alert('Submission failed', error.message); return; }
    setDone(data);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Couldn't load this study</Text>
        <Text style={styles.muted}>{loadError}</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (!study) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>Study not found</Text>
        <Text style={styles.muted}>This study may no longer be active, or doesn't exist.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to studies</Text>
        </Pressable>
      </View>
    );
  }

  if (alreadyResponded) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>{study.title}</Text>
        <Text style={styles.muted}>You already responded to this study. Status: {alreadyResponded.status}</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to studies</Text>
        </Pressable>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>{study.title}</Text>
        <Text style={styles.muted}>This study has no questions yet - check back later.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to studies</Text>
        </Pressable>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>Thanks for participating!</Text>
        <Text style={styles.muted}>{done.message}</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to studies</Text>
        </Pressable>
      </View>
    );
  }

  if (index >= questions.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneTitle}>Review & submit</Text>
        <Text style={styles.muted}>You've answered all {questions.length} questions.</Text>
        <Pressable style={styles.button} onPress={submit} disabled={submitting}>
          <Text style={styles.buttonText}>{submitting ? 'Submitting...' : 'Submit responses'}</Text>
        </Pressable>
      </View>
    );
  }

  const q = questions[index];
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${(index / questions.length) * 100}%` }]} /></View>
      <Text style={styles.muted}>Question {index + 1} of {questions.length}</Text>
      <Text style={styles.questionText}>{q.question_text}</Text>

      <QuestionInput question={q} onAnswer={recordAnswer} />
    </ScrollView>
  );
}

function QuestionInput({ question, onAnswer }: { question: Question; onAnswer: (a: Answer) => void }) {
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  if (question.question_type === 'single_choice' || question.question_type === 'yes_no') {
    return (
      <View>
        {question.options.map((o) => (
          <Pressable key={o.id} style={styles.option} onPress={() => onAnswer({ question_id: question.id, selected_option_ids: [o.id] })}>
            <Text>{o.option_text}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  if (question.question_type === 'multi_choice') {
    return (
      <View>
        {question.options.map((o) => {
          const isSelected = selected.includes(o.id);
          return (
            <Pressable
              key={o.id}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => setSelected((prev) => (isSelected ? prev.filter((x) => x !== o.id) : [...prev, o.id]))}
            >
              <Text>{o.option_text}</Text>
            </Pressable>
          );
        })}
        <Pressable style={styles.button} onPress={() => onAnswer({ question_id: question.id, selected_option_ids: selected })}>
          <Text style={styles.buttonText}>Next</Text>
        </Pressable>
      </View>
    );
  }

  if (question.question_type === 'rating_5' || question.question_type === 'rating_10') {
    const max = question.question_type === 'rating_5' ? 5 : 10;
    return (
      <View>
        <View style={styles.ratingRow}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <Pressable key={n} style={[styles.ratingButton, rating === n && styles.ratingButtonSelected]} onPress={() => setRating(n)}>
              <Text style={rating === n ? styles.ratingTextSelected : undefined}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.button} onPress={() => rating && onAnswer({ question_id: question.id, rating_value: rating })}>
          <Text style={styles.buttonText}>Next</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <TextInput
        style={[styles.input, question.question_type === 'long_text' && { height: 100 }]}
        multiline={question.question_type === 'long_text'}
        placeholder="Type your answer..."
        value={text}
        onChangeText={setText}
      />
      <Pressable style={styles.button} onPress={() => onAnswer({ question_id: question.id, text_answer: text })}>
        <Text style={styles.buttonText}>Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 20, backgroundColor: '#f7f8fa', flexGrow: 1 },
  muted: { color: '#6b7280', marginBottom: 8 },
  questionText: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  doneTitle: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#dc2626', marginBottom: 10 },
  progressBar: { height: 6, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#0f766e' },
  option: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 14, marginBottom: 8, backgroundColor: '#fff' },
  optionSelected: { borderColor: '#0f766e', backgroundColor: '#f0fdfa' },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 14, backgroundColor: '#fff', marginBottom: 12 },
  button: { backgroundColor: '#0f766e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontWeight: '600' },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  ratingButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  ratingButtonSelected: { backgroundColor: '#0f766e' },
  ratingTextSelected: { color: '#fff' },
});
