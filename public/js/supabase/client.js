// public/js/supabase/client.js
//
// WRITTEN, NOT EXECUTED, NOT WIRED INTO ANY HTML PAGE. This is the shared
// client for the full Supabase-backed web track (auth.js, participant.js,
// business.js, admin.js in this same folder) - the SQLite-backed app in
// public/js/api.js, participant.js, business.js, admin.js (one level up)
// is untouched and still what every existing HTML page actually loads.
//
// To switch a page from the SQLite track to this one: replace its
// <script src="/js/api.js"> (and the matching participant.js/business.js/
// admin.js) with these modules instead. Not done automatically anywhere -
// per the standing instruction not to change the working P0 unnecessarily.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'; // replace with your real project URL
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY'; // replace with your real anon key - never the service role key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Thin helper so every module below can produce the same {error} shape the
// old api.js's fetch wrapper used, minimizing changes needed in any HTML
// page's inline event handlers if/when this track is wired in.
export async function invoke(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    // supabase-js wraps non-2xx responses in a generic error whose useful
    // message is on error.context - unwrap it so callers see the actual
    // "Insufficient balance" / "Not eligible: ..." etc. text the Edge
    // Function returned, not a generic "Edge Function returned a non-2xx
    // status code".
    let message = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) message = body.error;
    } catch { /* context wasn't JSON or wasn't readable - fall back to error.message */ }
    throw new Error(message);
  }
  return data;
}
