// supabase/functions/generate-report/index.ts
//
// WRITTEN, NOT EXECUTED. Ports src/lib/report.js. Same hard rule preserved
// exactly: Observed Results / Calculated Statistics / Platform
// Recommendations stay three explicitly separate sections, nothing here is
// LLM-generated, every number is computed directly from `answers` rows.
// Also ports src/routes/business.js's auto-transition of a COMPLETED study
// to REPORT_READY the first time its report is viewed.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';
import { canTransition } from '../_shared/lifecycle.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const { research_project_id } = await req.json();

    const { data: project } = await admin.from('research_projects').select('*').eq('id', research_project_id).single();
    if (!project) throw new HttpError(404, 'Study not found');
    const { data: membership } = await admin.from('business_members')
      .select('business_id').eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (!membership) throw new HttpError(403, 'This study does not belong to your business');

    const { data: allResponses } = await admin.from('survey_responses').select('*').eq('research_project_id', research_project_id);
    const validResponses = (allResponses ?? []).filter((r) => r.status === 'VALID');
    const { data: questions } = await admin.from('survey_questions').select('*').eq('research_project_id', research_project_id).order('order_index');

    const totalResponses = (allResponses ?? []).length;
    const validCount = validResponses.length;
    const completedCount = (allResponses ?? []).filter((r) => r.completed_at).length;
    const completionRate = totalResponses > 0 ? Math.round((completedCount / totalResponses) * 1000) / 10 : 0;
    const validRate = totalResponses > 0 ? Math.round((validCount / totalResponses) * 1000) / 10 : 0;
    const validResponseIds = validResponses.map((r) => r.id);

    const questionAnalytics = [];
    for (const q of questions ?? []) {
      const { data: answers } = validResponseIds.length
        ? await admin.from('answers').select('*').eq('question_id', q.id).in('response_id', validResponseIds)
        : { data: [] as any[] };
      const base = { questionId: q.id, questionText: q.question_text, questionType: q.question_type, responseCount: (answers ?? []).length };

      if (['single_choice', 'yes_no', 'multi_choice'].includes(q.question_type)) {
        const { data: options } = await admin.from('question_options').select('*').eq('question_id', q.id).order('order_index');
        const counts: Record<string, number> = {};
        for (const a of answers ?? []) for (const id of a.selected_option_ids ?? []) counts[id] = (counts[id] ?? 0) + 1;
        const breakdown = (options ?? []).map((o) => ({
          option: o.option_text, count: counts[o.id] ?? 0,
          percent: (answers ?? []).length ? Math.round(((counts[o.id] ?? 0) / (answers ?? []).length) * 1000) / 10 : 0,
        }));
        questionAnalytics.push({ ...base, breakdown });
      } else if (['rating_5', 'rating_10'].includes(q.question_type)) {
        const values = (answers ?? []).map((a) => a.rating_value).filter((v) => v !== null && v !== undefined);
        const avg = values.length ? Math.round((values.reduce((s: number, v: number) => s + v, 0) / values.length) * 100) / 100 : null;
        questionAnalytics.push({ ...base, average: avg, distribution: values });
      } else {
        const texts = (answers ?? []).map((a) => (a.text_answer ?? '').toLowerCase());
        const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'is', 'it', 'to', 'of', 'for', 'in', 'on', 'with', 'i', 'my', 'we']);
        const freq: Record<string, number> = {};
        for (const t of texts) for (const w of t.split(/\W+/)) { if (w.length < 3 || stopwords.has(w)) continue; freq[w] = (freq[w] ?? 0) + 1; }
        const topThemes = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count }));
        questionAnalytics.push({ ...base, sampleAnswers: texts.slice(0, 5), topThemes });
      }
    }

    const recommendations: string[] = [];
    if (validCount < 30) recommendations.push(`Sample size (${validCount} valid responses) is small — treat findings as directional, not conclusive.`);
    const primaryChoice = questionAnalytics.find((q: any) => q.breakdown?.length);
    if (primaryChoice) {
      const top = [...(primaryChoice as any).breakdown].sort((a: any, b: any) => b.count - a.count)[0];
      if (top?.percent !== undefined) {
        recommendations.push(`On "${(primaryChoice as any).questionText}", the leading response was "${top.option}" at ${top.percent}% of respondents.`);
      }
    }

    // Auto-transition COMPLETED -> REPORT_READY on first view, same as the Node version.
    if (project.status === 'COMPLETED' && canTransition('COMPLETED', 'REPORT_READY')) {
      await admin.from('research_projects').update({ status: 'REPORT_READY' }).eq('id', research_project_id);
    }

    return json({
      project: { id: project.id, title: project.title, status: project.status, target_city: project.target_city },
      observedResults: { totalResponses, validResponses: validCount, flaggedOrRejected: totalResponses - validCount },
      calculatedStatistics: { completionRatePercent: completionRate, validResponseRatePercent: validRate },
      questionAnalytics,
      platformRecommendations: recommendations,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
