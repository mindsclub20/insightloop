# InsightLoop — Android (Expo)

**WRITTEN, NOT EXECUTED.** No Expo CLI, Android SDK, or emulator is available
in the sandbox this was built in (no network access at all — confirmed
before starting this phase). Every file here is real, reviewed TypeScript
written to Supabase's and Expo's documented patterns, but none of it has
been run. Treat this as a strong starting point to `npm install` and run
yourself, not a verified build.

## Why participant-only (business/admin stay web)

The brief allows either "role-based navigation in one app" or "web-first for
business/admin, explain the decision." Decision: **participant-only app.**

- Business study-creation (question builder, targeting, budget preview) and
  admin moderation (queues, tables, bulk actions) are dense, form-heavy,
  desktop-shaped workflows — meaningfully worse on a phone screen, better
  served by the existing web dashboards.
- Smaller attack surface and a simpler app-store compliance story: an app
  that only ever lets a signed-in adult complete surveys and manage a wallet
  is a much easier review/privacy story than one that also handles business
  payment data and admin moderation actions.
- Matches how comparable panel apps in this space typically ship.

If this decision changes later, the same screens/patterns here extend
directly — a business tab group would follow the exact same
Supabase-client-read / Edge-Function-write split already established.

## Setup

```bash
# 1. Scaffold a fresh Expo project to get current, mutually-compatible
#    dependency versions (recommended over trusting this repo's
#    hand-written package.json, which may drift from what's actually
#    current by the time you run this):
npx create-expo-app@latest insightloop-mobile-scaffold
# then copy this mobile/ directory's app/, lib/, context/ folders and
# config files (app.json, babel.config.js, tsconfig.json) over the fresh
# scaffold's equivalents, OR just run the two commands below directly in
# THIS mobile/ directory and let `expo install --fix` reconcile versions:

npm install
npx expo install --fix   # aligns every package.json version to what your installed Expo SDK actually expects

cp .env.example .env
# edit .env with your real Supabase project URL + anon key

npx expo start
# scan the QR code with Expo Go on an Android device, or press 'a' for an
# Android emulator if you have one configured
```

## Building a real APK/AAB

```bash
npm install -g eas-cli
eas login
eas build:configure   # creates/links an EAS project, fills app.json's extra.eas.projectId
eas build --platform android --profile preview   # or --profile production for a Play Store build
```
Requires a free (or paid, for higher build concurrency) Expo/EAS account.
Publishing to the Play Store additionally requires a Google Play Console
developer account (one-time $25 fee) and Google's standard app review.

## What's stubbed / not yet real

- **Device fingerprint** (`study/[id].tsx`) is a hardcoded placeholder
  string. A real build should use something like `expo-application`'s
  `getAndroidId()` or a persisted random UUID (same idea as the web app's
  `localStorage`-based fingerprint in `public/js/participant.js`) — not
  implemented here to avoid adding another dependency to a file already
  marked unexecuted.
- **Date-of-birth input** (`register.tsx`) is a raw text field
  (`YYYY-MM-DD`). Swap for `@react-native-community/datetimepicker` in a
  real build; text input was chosen here to avoid one more unverified
  native-module dependency.
- **Push notifications** (§22 of the brief) are not implemented at all —
  no Expo push token registration, no `send-notification` Edge Function
  wired up. This needs an `expo-notifications` integration plus a `device_tokens`
  table (schema not yet written) and is scoped as clear follow-up work, not
  partially faked here.
- **The `handle_new_user` Postgres trigger** that should reject signup for
  an under-18 `date_of_birth` server-side (the client-side check in
  `register.tsx` is real but bypassable by a modified client) is documented
  as needed in `docs/SUPABASE_SETUP.md` but not yet written as SQL — flagged
  there, not silently skipped.
