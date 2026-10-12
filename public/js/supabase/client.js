// Shared Supabase client for persistent InsightLoop auth and Postgres data.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dqfdecvmhzmipqvghvwl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4grIGVXg906CtVOgcbvH_A_jg3jZWrH';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('InsightLoop Supabase configuration is missing.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'insightloop-auth',
  },
});

export async function invoke(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let message = error.message;
    try {
      const responseBody = await error.context?.json();
      if (responseBody?.error) message = responseBody.error;
    } catch { /* Fall back to Supabase's message if no JSON response exists. */ }
    throw new Error(message);
  }
  return data;
}
