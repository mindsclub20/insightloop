# Future AI integration

## Goal
Add an AI-assisted survey builder later without exposing provider credentials to the browser.

## Configuration
Set provider credentials only in server-side environment settings:
- AI_PROVIDER (for example, openai)
- AI_MODEL (choose a model supported by the selected provider)
- OPENAI_API_KEY (secret; never use a NEXT_PUBLIC or browser-exposed prefix)

## Suggested integration boundary
1. Browser sends a validated survey brief to a server endpoint.
2. Server checks the signed-in user's role, rate limits the request, and validates input length.
3. Server calls the configured provider using the secret environment variable.
4. Server returns a structured draft of survey questions for the business to review.
5. Persist the draft only after explicit user confirmation.

## Safety and reliability
- Never send participant personal data or secret credentials to the model unless strictly needed.
- Treat model output as an untrusted draft; validate question types, lengths, and option counts.
- Set request timeouts and usage limits. Show clear errors when the provider is unavailable.
- Do not describe this feature as active until the provider adapter, endpoint, and integration tests are implemented.

## Current status
This is setup guidance only. The current app does not yet call an AI API. The production Vercel configuration must be updated to run authenticated server endpoints before either AI calls or password-only admin sign-in can work in production.
