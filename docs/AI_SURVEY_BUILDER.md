# Business AI Survey Builder

The AI survey builder is available only inside the authenticated Supabase business dashboard at `/supabase-business/dashboard.html`.

## Flow and safeguards

1. A signed-in business user enters a plain-language research command and audience settings.
2. The authenticated `generate-ai-survey` Edge Function asks Gemini for a structured JSON survey draft. It does not create or publish a study.
3. The business reviews and can edit the title, objective, question text, answer types, and options.
4. Only after the business clicks **Create & submit for admin approval** does the browser call the existing create-study, add-question, and submit-for-approval functions.
5. The existing backend checks business verification. Submitted surveys remain pending until an administrator approves them; they are not immediately public.

The Edge Function verifies the caller's Supabase JWT and BUSINESS role, checks that a business membership exists, limits the command and audience fields, and validates the generated output against supported question types. The Gemini API key is server-side only.

## Configure Gemini

1. Create a Gemini API key in Google AI Studio.
2. In the Supabase dashboard, open the **Survey** project (`dqfdecvmhzmipqvghvwl`), then **Edge Functions → Secrets**.
3. Add `GEMINI_API_KEY` with the key value. Optionally add `GEMINI_MODEL` to override the default model (`gemini-3.8-flash`).
4. Deploy the `generate-ai-survey` Edge Function.
5. Run `node --test test/ai-survey-schema.test.js` locally and test the flow with a verified business test account.

Never put the Gemini API key in HTML, JavaScript delivered to browsers, or Git. Do not paste it into chat. Free-tier availability and quotas can change. Google's Gemini free tier may use submitted prompts and outputs to improve its products, so do not include customer secrets or sensitive personal information in survey commands.

## Limits

- Command: 8–1,200 characters.
- Survey: 1–8 questions.
- Choice questions: 2–8 unique options.
- Target respondents: 10–500; reward: ₹1–₹10,000 per response.
- Target age: 18–100.
- AI output is a draft, not research truth. The business must review it before submission.
- No real payment or payout is initiated by this feature.
