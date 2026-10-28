export const providers = {
  google: { name: 'Google Gemini', model: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL' },
  deepseek: { name: 'DeepSeek', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL' },
  anthropic: { name: 'Anthropic', model: 'claude-haiku-4-5', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL' }
} as const;
export type Provider = keyof typeof providers;
