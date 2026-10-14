export const AGENT_MODEL = 'openai/gpt-6.1-sol'
export const AGENT_EFFORT = 'low'
// gpt-6.1-sol has a -fast variant, so fx's /model asks for a speed; normal keeps
// requests on AGENT_MODEL, the only id the gateway route lets through.
export const AGENT_SPEED = 'normal'
