# Anvesh — Bolt redesign integration

## Goal
Integrate the Bolt-generated React/Vite research workspace into the existing Anvesh repository without replacing the repository, production deployment, Supabase project, or current user flows.

## Non-negotiable constraints
- Work only on `redesign/bolt-anvesh-integration` until preview QA passes.
- Preserve the current GitHub repository and Vercel project.
- Keep existing business, participant, and admin roles and the current authentication/session contract.
- Do not add provider API keys yet. AI, web search, and n8n integrations must show a clear setup/disabled state until credentials are configured.
- Do not apply the Bolt ZIP's seven migrations directly to the existing Supabase production database. Its schema differs from the existing project.
- Do not commit secrets, .env files, service-role keys, or provider credentials.
- Production deployment and merge to main happen only after build, smoke tests, and role-based QA pass.

## Integration approach
1. Treat the Bolt ZIP as a UI/UX source, not as a replacement backend or database.
2. Map its routes and views onto existing application roles and server endpoints.
3. Keep the existing Node server and Supabase Edge Functions as the backend contract unless a specific, tested migration is approved.
4. Create a compatibility layer for the React UI. Centralize API calls, session handling, loading/error states, and feature flags rather than scattering direct Supabase queries through components.
5. Reconcile each required table against the existing schema before writing any SQL. Prefer additive, reversible migrations with explicit RLS policies.
6. Gate unavailable AI features behind configuration checks and provide a usable non-AI/manual workflow.
7. Add tests for unauthenticated access, business draft/publish, participant response submission and token rewards, admin controls, and research workspace access.
8. Run dependency installation, production build, tests, and preview smoke tests. Record any blocker rather than marking a check as passed without evidence.

## Release checklist
- [ ] Bolt UI source is integrated into this branch.
- [ ] Existing routes and role flows remain available.
- [ ] API contracts are mapped and exercised.
- [ ] Supabase schema and RLS are reconciled without destructive production changes.
- [ ] No secrets are present in tracked files.
- [ ] Lint/type-check/build/tests pass.
- [ ] Preview deployment is verified on desktop and mobile.
- [ ] Production is changed only after explicit review of the preview.

## Current status
This document records the integration constraints and release gate. It is not evidence that the UI integration, build, database migration, or deployment has completed.