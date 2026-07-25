import { loadEnv, requireLlmKey } from '@git-help/core/lib/env.js';
import { llmJsonObject } from '@git-help/core/lib/llm.js';

loadEnv();
requireLlmKey();
const t = Date.now();
const out = await llmJsonObject({
  messages: [
    { role: 'system', content: 'Return JSON only.' },
    { role: 'user', content: 'Reply with {"pong":true}' },
  ],
});
console.log(JSON.stringify({ ms: Date.now() - t, out }));
