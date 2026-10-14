# Business AI Survey Builder

The AI survey builder is available only inside the authenticated Supabase business dashboard at `/supabase-business/dashboard.html`.

## Flow and safeguards

1. A signed-in business user enters a plain-language research command and audience settings.
2. The authenticated `generate-ai-survey` Edge Function asks Gemini for a structured JSON survey.
3. The business clicks **Run AI Autopilot** once. The dashboard automatically creates the study, adds the validated questions, and submits it through the existing authenticated functions.
4. Existing backend checks enforce business verification and question limits. If any step fails, Autopilot stops and reports that a draft may need recovery; retrying blindly could create duplicates.
5. Submission is not publication: the current payment provider is manual-only and the existing platform approval gate remains in place. A survey is not live and participants are not promised rewards until the payment and platform gates are genuinely satisfied.

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
- Autopilot can create and submit a survey without manual question-by-question supervision; it does not guarantee that every generated survey is suitable.
- No real payment, escrow, payout, or automated platform approval is implemented by this feature. Do not represent this as a fully autonomous live marketplace yet.
