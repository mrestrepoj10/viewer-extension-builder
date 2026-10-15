import type { FxSpeed } from '@/components/ui/fx-terminal/runtime'

export const AGENT_MODEL = 'openai/gpt-6.1-sol'
export const AGENT_EFFORT = 'low'
// Sent to fx's /model only when the gateway prices a fast mode for AGENT_MODEL;
// normal keeps requests on AGENT_MODEL.
export const AGENT_SPEED: FxSpeed = 'normal'
// The gateway route lets these through; switch inside the terminal with
// `/model anthropic/claude-haiku-5.5 low` (the choice lasts for the session).
export const ALLOWED_MODELS = [AGENT_MODEL, 'anthropic/claude-haiku-5.5'] as const
