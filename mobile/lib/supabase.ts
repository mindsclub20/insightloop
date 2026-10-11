// mobile/lib/supabase.ts
//
// WRITTEN, NOT EXECUTED — no Expo/Android toolchain in this sandbox. Follows
// Supabase's documented Expo integration exactly: AsyncStorage for session
// persistence (React Native has no localStorage), autoRefreshToken tied to
// AppState so the session refreshes while the app is foregrounded and stops
// burning requests in the background.
//
// SECURITY: only EXPO_PUBLIC_* env vars are read here, and only the anon
// key - never the service role key. EXPO_PUBLIC_ vars are compiled into the
// JS bundle and are as readable as any other client-side value once the
// APK is in someone's hands; that's fine for the anon key (RLS is the real
// boundary) and would be a serious leak for the service role key, which is
// why it's never referenced anywhere under mobile/.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at startup rather than making confusing network errors
  // later - see mobile/.env.example for what to set these to.
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. Copy mobile/.env.example to mobile/.env and fill in your Supabase project values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no browser URL to parse a redirect from on native
  },
});

// Supabase's documented pattern: pause/resume token auto-refresh with the
// app's foreground state instead of refreshing on a fixed timer regardless
// of whether anyone is using the app.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
