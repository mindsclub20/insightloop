import { adminClient, HttpError, requireProfile } from '../_shared/supabase.ts';
import { corsHeaders, handleOptions, json } from '../_shared/cors.ts';

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'Interests must be a list.');
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().toLowerCase().slice(0, 60);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = adminClient();
    const { userId } = await requireProfile(req, admin);
    const body = await req.json().catch(() => { throw new HttpError(400, 'Invalid JSON body.'); });
    const tags = normalizeTags(body?.interests ?? []);

    const { data: existingRows, error: readError } = await admin
      .from('user_interests').select('tag').eq('user_id', userId);
    if (readError) throw new HttpError(500, 'Could not load saved interests.');

    const existing = new Set((existingRows || []).map((row: {tag: string}) => row.tag.toLowerCase()));
    const rows = tags.filter((tag) => !existing.has(tag)).map((tag) => ({ user_id: userId, tag }));
    if (rows.length) {
      const { error: insertError } = await admin.from('user_interests').insert(rows);
      if (insertError) throw new HttpError(500, 'Could not save interests.');
    }

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(userId);
    if (authReadError || !authData.user) throw new HttpError(500, 'Interests saved, but profile setup could not be finalized.');
    const { error: metadataError } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...authData.user.user_metadata, pending_interests: null },
    });
    if (metadataError) throw new HttpError(500, 'Interests saved, but pending preferences could not be cleared.');

    return json({ saved: rows.length, total: tags.length });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Could not save interests.';
    return json({ error: message }, status);
  }
});
