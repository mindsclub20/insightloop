import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfiguredAIProviders, getMissingAIProviders, getProviderOrder } from '../supabase/functions/_shared/research-agent-utils.js';

test('discovers configured AI providers without exposing secret values', () => {
  const providers = getConfiguredAIProviders({
    GEMINI_API_KEY: 'secret-gemini',
    GROQ_API_KEY: 'secret-groq',
    OPENAI_API_KEY: 'secret-openai',
    OLLAMA_BASE_URL: 'https://ollama.example.test',
  });
  assert.deepEqual(providers.map((p) => p.id), ['gemini', 'groq', 'openai', 'ollama']);
  assert.ok(providers.every((p) => !('apiKey' in p) && !('value' in p)));
});

test('reports missing provider key names only', () => {
  assert.deepEqual(getMissingAIProviders({ GROQ_API_KEY: 'secret' }), [
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'XAI_API_KEY', 'HUGGINGFACE_API_KEY', 'OLLAMA_BASE_URL',
  ]);
});

test('uses an explicit provider order and ignores unknown providers', () => {
  assert.deepEqual(
    getProviderOrder({ ANVESH_AI_PROVIDER_ORDER: 'groq,unknown,openai,groq' }),
    ['groq', 'openai'],
  );
});

test('per-workload provider override takes precedence when configured', () => {
  const env = {
    GROQ_API_KEY: 'secret',
    OPENAI_API_KEY: 'secret',
    ANVESH_PROVIDER_WEB_RESEARCH: 'openai',
  };
  const providers = getConfiguredAIProviders(env, 'web_research');
  assert.equal(providers[0].id, 'openai');
});
