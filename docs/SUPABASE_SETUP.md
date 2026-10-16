# Supabase Setup — Option A Deployment Guide

The repository now includes a Supabase-backed web track and Edge Functions. The connected Supabase project has an existing schema, RLS policies, Auth-triggered profile creation, and deployed Edge Functions. Do not recreate the project or blindly replay migrations. Inspect the live migration history before applying anything new.

## 1. Credentials and project

Use the existing project already referenced by `public/js/supabase/client.js` unless the owner explicitly chooses a different project. The project URL and publishable/anon key are public client configuration; the service-role key is not.

| Credential | Where it is used | Ever appears client-side? |
|---|---|---|
| Project URL | Web app and Edge Functions | Yes |
| Publishable / anon key | Web app and caller-scoped Edge Function clients | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Edge Function server-side client | **Never** |
| AI provider key | AI Edge Functions | **Never** |

## 2. Authentication URL configuration

In Supabase Dashboard → Authentication → URL Configuration:

- Set the Site URL to `https://insightloop-lac.vercel.app`.
- Allow the exact production confirmation redirect `https://insightloop-lac.vercel.app/auth/confirm.html`.
- Add the corresponding Vercel preview URL pattern only if preview signup testing is required; do not allow arbitrary external redirect URLs.
- Keep email confirmation enabled for production accounts and configure the email templates to use Supabase's supported confirmation URL. The confirmation page supports both the standard callback/session flow and a `token_hash` + `type` callback.
- Configure password-reset email delivery and redirect URLs separately before enabling password recovery in the UI.

The app's signup code now redirects to `/auth/confirm.html`. The browser flow must still be verified against the live email provider; code changes alone do not prove delivery.

## 3. Existing migrations and schema

The connected project already contains InsightLoop-related tables, applied migrations, and active Edge Functions. Review the live migration history and current schema before changing production. The SQL files in `/migrations/` are historical/source-controlled references, not instructions to blindly execute every file again.

For a new environment, use the repository's migration sequence only after checking that the target database is empty or safely compatible. Stop and inspect any migration failure; never drop tables or clear production records to make setup pass.

## 4. Edge Functions and secrets

The connected project has active functions for business and survey workflows, administration, reporting, withdrawals, and AI survey generation. Verify each function's deployed version and runtime behavior before relying on it.

Server-side function secrets may include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` and/or `XAI_API_KEY` for AI generation

Never put service-role or model-provider keys in browser JavaScript, public Vercel variables, or Git. Keep real payment-provider integration disabled until funding, refunds, compliance, webhook verification, and reconciliation are implemented.

## 5. Security and operational checks

Before real-user onboarding:

- Re-run authorization tests against the deployed database policies and Edge Functions.
- Confirm role assignment is server-controlled and clients cannot self-promote.
- Confirm business users cannot read another business's private records or identifiable response data.
- Verify all user-facing routes enforce authentication and role checks.
- Review Supabase Security and Performance Advisor findings. RLS-enabled AI usage/limit tables with no client policies may be intentionally service-role-only; verify intended access before adding policies.
- Enable leaked-password protection in Auth settings if supported by the project's plan/configuration.
- Configure a reliable email provider and test real confirmation and password-reset delivery.

## 6. Verification required

Use isolated adult test accounts and test data. Verify registration → delivered email → confirmation → login → session restoration → logout, as well as protected API access, business survey creation, participant submission, and data persistence. Never use real payment rails during tests, and keep participant access disabled for anyone under 18 until applicable legal, privacy, consent, and payment-provider requirements are resolved.
