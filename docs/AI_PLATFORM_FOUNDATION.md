# InsightLoop AI Platform Foundation

Status: implementation branch; not production-enabled.

## Product contract

- AI tools are included in the business platform fee, subject to transparent fair-use limits.
- A business does not bring its own key. Provider keys belong to InsightLoop and are server-side secrets.
- Every request is authenticated and associated with the business from its verified membership. Never accept a business ID from the browser as authority.
- Each provider call receives only the minimum fields needed for the task. Do not put one business's private data into another business's prompt or shared cache.
- Generated advertisements are drafts. They are not published automatically; business approval and platform/policy checks are required.
- Surveys continue through existing payment and platform approval gates. AI generation is not a payment, verification, or publication event.

## Providers

The shared server-only adapter supports:
- Gemini: `GEMINI_API_KEY`, optional `GEMINI_MODEL`
- xAI Grok: `XAI_API_KEY`, optional `XAI_MODEL`
- `AI_PRIMARY_PROVIDER=gemini|grok` selects the preferred provider. The other configured provider is attempted if the preferred provider fails.
- No credentials are shipped to the browser. Never commit keys or paste them into chat.

The model defaults are conservative placeholders and must be checked against the current models enabled for the account before production. A provider being configured does not mean its API is free.

## Secrets to add after review

Supabase Edge Function secrets:
- `GEMINI_API_KEY` (primary provider key)
- `XAI_API_KEY` (optional Grok backup)
- `AI_PRIMARY_PROVIDER=gemini` (optional)
- `GEMINI_MODEL` / `XAI_MODEL` (optional model overrides)

Do not add secrets to Vercel unless a Vercel server route specifically needs them. The current business AI feature uses Supabase Edge Functions.

## Usage and privacy

Migration `005_ai_usage_and_business_controls.sql` adds a server-only usage ledger and per-business limits. No direct client policies are granted. The current ad endpoint logs successful usage after the migration is applied. Before enabling this endpoint, complete:
1. Add a database-side atomic quota check/reservation to prevent concurrent requests exceeding a limit.
2. Add a database-side monthly budget check based on actual provider usage/cost data.
3. Ensure usage is logged on failure/rate-limit as well as success.
4. Set an operational default for businesses that have no explicit limits row.
5. Add per-user and per-business rate limiting.
6. Review current provider model availability, terms, pricing, and data-retention settings.
7. Add authenticated end-to-end tests for cross-business access, missing keys, provider failure/fallback, malformed model output, and quota exhaustion.
8. Wire the advertising form into the authenticated business dashboard and test on a preview deployment.

## Apply and verify

1. Review this branch and migration in a non-production Supabase project first.
2. Run SQL/security tests and deploy the new Edge Function to preview.
3. Add test keys only in preview secrets.
4. Test survey generation and ad drafting using two test businesses; verify neither can read the other's records.
5. Check monthly usage and provider failure handling.
6. Only then merge/deploy to production after explicit approval.

## Current limitations

This foundation is not a claim that AI is fully production-ready. The migration is not automatically applied, the new function is not deployed by this commit, the UI is not yet wired, quotas need an atomic server-side enforcement path, and provider costs are not yet calculated from actual usage. Do not market automated ad publishing, escrow, payouts, or fully autonomous operation until those workflows are separately implemented and verified.
