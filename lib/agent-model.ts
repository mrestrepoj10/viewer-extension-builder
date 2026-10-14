import type { FxSpeed } from '@/components/ui/fx-terminal/runtime'

export const AGENT_MODEL = 'openai/gpt-6.1-sol'
export const AGENT_EFFORT = 'low'
// Sent to fx's /model only when the gateway prices a fast mode for AGENT_MODEL;
// normal keeps requests on AGENT_MODEL, the only id the gateway route lets through.
export const AGENT_SPEED: FxSpeed = 'normal'
