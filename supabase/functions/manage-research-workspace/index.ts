// Backend-only CRUD for persisted research workspace artifacts.
// Requires the existing Supabase Edge Function secrets and business auth contract.
// Does not generate AI content or modify survey/token workflows.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

const TABLES = {
  source: 'research_sources',
  finding: 'research_findings',
  report: 'research_reports',
} as const;

type ArtifactType = keyof typeof TABLES;

function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST for research workspace actions.');
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const body = await req.json();
    const type = body.type as ArtifactType;
    const action = body.action as string;
    if (!(type in TABLES)) throw new HttpError(400, 'type must be source, finding, or report.');

    const projectId = textField(body.research_project_id, 'research_project_id', 64);
    const { data: project, error: projectError } = await admin
      .from('research_projects').select('id,business_id').eq('id', projectId).maybeSingle();
    if (projectError) throw new HttpError(500, 'Unable to load research project.');
    if (!project) throw new HttpError(404, 'Research project not found.');

    const { data: membership, error: membershipError } = await admin
      .from('business_members').select('business_id')
      .eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (membershipError) throw new HttpError(500, 'Unable to verify project access.');
    if (!membership) throw new HttpError(403, 'This research project does not belong to your business.');

    const table = TABLES[type];
    if (action === 'list') {
      const { data, error } = await admin.from(table).select('*')
        .eq('research_project_id', projectId).order('created_at', { ascending: false });
      if (error) throw new HttpError(500, 'Unable to load research workspace records.');
      return json({ items: data ?? [] });
    }

    if (action === 'create') {
      let payload: Record<string, unknown>;
      if (type === 'source') {
        payload = {
          research_project_id: projectId, created_by: userId,
          title: textField(body.title, 'title', 240),
          source_type: ['web','document','interview','survey','dataset','other'].includes(body.source_type) ? body.source_type : 'other',
          source_url: typeof body.source_url === 'string' && body.source_url.trim() ? body.source_url.trim().slice(0, 2048) : null,
          notes: typeof body.notes === 'string' ? body.notes.slice(0, 12000) : '',
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
        };
      } else if (type === 'finding') {
        payload = {
          research_project_id: projectId, created_by: userId,
          title: textField(body.title, 'title', 240),
          detail: textField(body.detail, 'detail', 12000),
          evidence: typeof body.evidence === 'string' ? body.evidence.slice(0, 12000) : '',
          confidence: ['low','medium','high'].includes(body.confidence) ? body.confidence : 'medium',
          status: 'draft',
          source_ids: Array.isArray(body.source_ids) ? body.source_ids.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [],
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
        };
      } else {
        const { data: latest } = await admin.from('research_reports').select('version')
          .eq('research_project_id', projectId).order('version', { ascending: false }).limit(1).maybeSingle();
        payload = {
          research_project_id: projectId, created_by: userId,
          title: textField(body.title, 'title', 240),
          report_data: body.report_data && typeof body.report_data === 'object' ? body.report_data : null,
          version: Number.isInteger(body.version) && body.version > 0 ? body.version : ((latest?.version ?? 0) + 1),
          report_status: 'draft',
        };
        if (payload.report_data === null) throw new HttpError(400, 'report_data must be a JSON object.');
      }
      const { data, error } = await admin.from(table).insert(payload).select('*').single();
      if (error) throw new HttpError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'That report version already exists.' : 'Unable to save research workspace record.');
      return json({ item: data }, 201);
    }

    if (action === 'update' || action === 'delete') {
      const id = textField(body.id, 'id', 64);
      if (action === 'delete') {
        const { error } = await admin.from(table).delete().eq('id', id).eq('research_project_id', projectId);
        if (error) throw new HttpError(500, 'Unable to delete research workspace record.');
        return json({ ok: true });
      }
      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = textField(body.title, 'title', 240);
      if (type === 'source') {
        if (body.source_url !== undefined) updates.source_url = typeof body.source_url === 'string' ? body.source_url.slice(0, 2048) : null;
        if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.slice(0, 12000) : '';
        if (body.source_type !== undefined && ['web','document','interview','survey','dataset','other'].includes(body.source_type)) updates.source_type = body.source_type;
      } else if (type === 'finding') {
        if (body.detail !== undefined) updates.detail = textField(body.detail, 'detail', 12000);
        if (body.evidence !== undefined) updates.evidence = typeof body.evidence === 'string' ? body.evidence.slice(0, 12000) : '';
        if (body.confidence !== undefined && ['low','medium','high'].includes(body.confidence)) updates.confidence = body.confidence;
        if (body.status !== undefined && ['draft','verified','rejected'].includes(body.status)) updates.status = body.status;
        if (body.source_ids !== undefined && Array.isArray(body.source_ids)) updates.source_ids = body.source_ids.filter((x: unknown) => typeof x === 'string').slice(0, 100);
      } else {
        if (body.report_data !== undefined && body.report_data && typeof body.report_data === 'object') updates.report_data = body.report_data;
        if (body.report_status !== undefined && ['draft','reviewed','final'].includes(body.report_status)) updates.report_status = body.report_status;
      }
      updates.updated_at = new Date().toISOString();
      const { data, error } = await admin.from(table).update(updates)
        .eq('id', id).eq('research_project_id', projectId).select('*').maybeSingle();
      if (error) throw new HttpError(500, 'Unable to update research workspace record.');
      if (!data) throw new HttpError(404, 'Research workspace record not found.');
      return json({ item: data });
    }

    throw new HttpError(400, 'action must be list, create, update, or delete.');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
