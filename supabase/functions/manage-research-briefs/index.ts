// Persist and retrieve research planner briefs for an authenticated business.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${field} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST for research brief actions.');
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const body = await req.json();
    const action = body.action;
    const { data: membership, error: membershipError } = await admin.from('business_members')
      .select('business_id').eq('user_id', userId).limit(1).maybeSingle();
    if (membershipError) throw new HttpError(500, 'Unable to verify business membership.');
    if (!membership) throw new HttpError(403, 'No business is associated with this account.');
    const businessId = membership.business_id;

    if (action === 'list') {
      const { data, error } = await admin.from('research_briefs').select('id,title,brief_data,created_at,updated_at')
        .eq('business_id', businessId).order('updated_at', { ascending: false }).limit(100);
      if (error) throw new HttpError(500, 'Unable to load saved research briefs.');
      return json({ items: data ?? [] });
    }
    if (action === 'create') {
      const title = requiredText(body.title, 'title', 120);
      if (!body.brief_data || typeof body.brief_data !== 'object' || Array.isArray(body.brief_data)) {
        throw new HttpError(400, 'brief_data must be a JSON object.');
      }
      const { data, error } = await admin.from('research_briefs').insert({
        business_id: businessId, created_by: userId, title, brief_data: body.brief_data,
      }).select('id,title,brief_data,created_at,updated_at').single();
      if (error) throw new HttpError(500, 'Unable to save research brief.');
      return json({ item: data }, 201);
    }
    if (action === 'update') {
      const id = requiredText(body.id, 'id', 64);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title !== undefined) updates.title = requiredText(body.title, 'title', 120);
      if (body.brief_data !== undefined) {
        if (!body.brief_data || typeof body.brief_data !== 'object' || Array.isArray(body.brief_data)) {
          throw new HttpError(400, 'brief_data must be a JSON object.');
        }
        updates.brief_data = body.brief_data;
      }
      const { data, error } = await admin.from('research_briefs').update(updates).eq('id', id)
        .eq('business_id', businessId).select('id,title,brief_data,created_at,updated_at').maybeSingle();
      if (error) throw new HttpError(500, 'Unable to update research brief.');
      if (!data) throw new HttpError(404, 'Research brief not found.');
      return json({ item: data });
    }
    if (action === 'delete') {
      const id = requiredText(body.id, 'id', 64);
      const { data, error } = await admin.from('research_briefs').delete().eq('id', id)
        .eq('business_id', businessId).select('id').maybeSingle();
      if (error) throw new HttpError(500, 'Unable to delete research brief.');
      if (!data) throw new HttpError(404, 'Research brief not found.');
      return json({ ok: true });
    }
    throw new HttpError(400, 'action must be list, create, update, or delete.');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
