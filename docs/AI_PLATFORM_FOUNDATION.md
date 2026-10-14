# InsightLoop AI Platform Foundation

Status: implementation branch with preview frontend. AI calls remain dependent on configured server-side provider secrets and live verification.

## Product contract

- AI tools are included in the business platform fee, subject to transparent fair-use limits.
- Businesses do not bring their own keys. Provider keys belong to InsightLoop and are server-side secrets.
- Every request is authenticated and associated with the business from its verified membership. Browser-supplied business IDs are never trusted.
- Each provider call receives only the minimum fields needed for the task. One business's private data must never enter another business's prompt or shared cache.
- Generated advertisements are drafts. They are not published automatically; business approval and platform/policy checks remain required.
- Survey generation returns a draft. Existing payment and platform approval gates remain separate and are not bypassed by AI generation.

## Providers

- Gemini: `GEMINI_API_KEY`, optional `GEMINI_MODEL`
- xAI Grok: `XAI_API_KEY`, optional `XAI_MODEL`
- `AI_PRIMARY_PROVIDER=gemini|grok` selects the preferred provider; the other configured provider is tried if the preferred provider fails.
- Credentials are never shipped to the browser or committed to source control.
- Default model names are configurable and must be verified against the models enabled for the account before enabling paid usage. Provider calls may incur charges.

## Supabase Edge Function secrets

- `GEMINI_API_KEY` — required for Gemini.
- `XAI_API_KEY` — optional Grok backup.
- `AI_PRIMARY_PROVIDER=gemini` — optional.
- `GEMINI_MODEL` / `XAI_MODEL` — optional model overrides.

The business AI UI calls Supabase Edge Functions; do not add provider credentials to Vercel/browser environment variables.

## Usage controls and privacy

Migration `005_ai_usage_and_business_controls.sql` creates a server-only usage ledger and per-business limits. Direct client access is revoked. The `reserve_ai_usage` database function serializes reservations per business and enforces monthly request and reservation-budget limits before a provider is called. Both survey and ad generation use the same server-side provider adapter and reservation helper.

The budget control reserves a fixed estimated amount per request (currently $0.025). This is a fair-use guard, **not an exact provider invoice calculation or a guarantee that provider charges cannot exceed the configured budget**. Configure provider-side spending alerts/limits and review real usage regularly. Failed calls remain counted conservatively against fair use.

## Verification still required

1. Run authenticated end-to-end tests for both survey and ad generation with test business accounts.
2. Verify two businesses cannot read or modify each other's data.
3. Verify quota exhaustion, disabled business, missing keys, provider failure/fallback, malformed output, and failed usage finalization.
4. Verify provider model names and current terms/pricing in the provider console.
5. Configure provider-side spending alerts/limits; fixed request reservations are only an estimate.
6. Consider per-user/IP rate limiting and abuse monitoring before broad public launch.
7. Re-test the dashboard on a preview deployment after the backend function is deployed.
8. Keep survey payment confirmation and platform approval, and ad review/publication, as separate explicit gates.

## Deployment status

The frontend preview can deploy independently of Supabase. Applying the migration and deploying Edge Functions changes the connected Supabase project; verify those changes and run authenticated tests before considering production launch complete. The Grok key has not been added; do not ask for or paste secrets in chat. Add it only through Supabase Edge Function secrets after the backend safeguards are in place.

## Current limitations

This is not a claim that the full platform is production-ready. Real authenticated AI requests, provider fallback, usage enforcement, business isolation, and provider-side spending controls must be verified in the connected environment. Do not claim fully autonomous ad publishing, escrow, payouts, or production-grade cost accounting until those workflows are separately implemented and tested.
