export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type AgentRole = 'user' | 'assistant'

export interface AgentTextPart {
  type: 'text'
  text: string
}

export interface AgentReasoningPart {
  type: 'reasoning'
  text: string
}

/** Base64 without the `data:` prefix, so it can go to a model and into an img src alike. */
export interface AgentImage {
  mimeType: string
  base64: string
  width?: number
  height?: number
}

export interface AgentImagePart extends AgentImage {
  type: 'image'
  alt?: string
}

export type AgentActionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'partial'

/** One tool call as the UI shows it. `label` and `detail` come from the tool, not the model. */
export interface AgentAction {
  id: string
  tool: string
  label: string
  detail?: string
  status: AgentActionStatus
  startedAt: number
  endedAt?: number
  input: unknown
  output?: unknown
  error?: string
  undoable: boolean
  /** The key the tool catalog's undo stack knows this action by. */
  undoId?: string
  setId?: string
  /** `#rrggbb` the action painted, for a legend swatch. */
  color?: string
  image?: AgentImage
}

export interface AgentActionPart {
  type: 'action'
  action: AgentAction
}

export type AgentMessagePart = AgentTextPart | AgentReasoningPart | AgentActionPart | AgentImagePart

/** Parts keep the order the runtime produced them in; `createdAt` is epoch milliseconds. */
export interface AgentMessage {
  id: string
  role: AgentRole
  parts: AgentMessagePart[]
  createdAt: number
}

/** A named group of viewer elements the agent and the user can both refer to (`set-1`). */
export interface ElementSet {
  id: string
  label: string
  dbIds: readonly number[]
  createdAt: number
  /** The tool that produced it. */
  origin: string
}

export interface AgentSelectionContext {
  dbIds: readonly number[]
  summary: string
}

export type AgentTurnStatus = 'idle' | 'running' | 'cancelling'

export type AgentRuntimeStatus = 'starting' | 'ready' | 'unavailable' | 'error'

export type AgentUnavailableReason =
  | 'unsupported-browser'
  | 'no-model'
  | 'not-configured'
  | 'rate-limited'
  | 'model-not-allowed'
  | 'runtime-error'

export type AgentNoticeTone = 'neutral' | 'warning' | 'danger'

export interface AgentNotice {
  title: string
  description: string
  tone: AgentNoticeTone
}

export function describeAgentUnavailableReason(reason: AgentUnavailableReason): AgentNotice {
  switch (reason) {
    case 'unsupported-browser':
      return {
        title: "This browser can't run the agent",
        description:
          'The agent runs in your browser on WebAssembly JSPI. Use Chrome or Edge 137 or later, or Safari 27 or later.',
        tone: 'warning',
      }
    case 'no-model':
      return {
        title: 'Open a model to start',
        description: 'The agent works on the model loaded in the viewer.',
        tone: 'neutral',
      }
    case 'not-configured':
      return {
        title: "The agent isn't set up on this server",
        description:
          'The model proxy has no AI Gateway key. Set AI_GATEWAY_API_KEY on the server and redeploy.',
        tone: 'danger',
      }
    case 'rate-limited':
      return {
        title: 'Too many requests for now',
        description:
          'The model proxy is limiting requests from this network. Try again in a minute.',
        tone: 'warning',
      }
    case 'model-not-allowed':
      return {
        title: "This model isn't allowed here",
        description: 'The model proxy only accepts the model this deployment is configured for.',
        tone: 'danger',
      }
    case 'runtime-error':
      return {
        title: 'The agent stopped unexpectedly',
        description: 'Reload the page to start it again. The viewer keeps working meanwhile.',
        tone: 'warning',
      }
  }
}

export type AgentToolSchemaProperty =
  | {
      type: 'string'
      description?: string
      enum?: string[]
      maxLength?: number
    }
  | {
      type: 'number' | 'integer'
      description?: string
      minimum?: number
      maximum?: number
    }
  | {
      type: 'boolean'
      description?: string
    }
  | {
      type: 'array'
      description?: string
      items: { type: 'string' | 'number' | 'integer' }
      maxItems?: number
    }

/** The JSON Schema subset tools declare: a flat object, closed to unknown keys. */
export type AgentToolSchema = {
  type: 'object'
  properties: { [name: string]: AgentToolSchemaProperty }
  required?: string[]
  additionalProperties: false
}

/** What a tool hands back to the runtime: `text` is what the model reads. */
export interface AgentToolResult {
  text: string
  label: string
  detail?: string
  setId?: string
  color?: string
  image?: AgentImage
  undoable?: boolean
  undoId?: string
  /** The tool did part of what it was asked: its output was cut, or a view is still loading. */
  partial?: boolean
}

export interface AgentToolContext {
  signal: AbortSignal
  /** The runtime's id for this call, reused as the undo key when present. */
  actionId?: string
}

/** Runtime-agnostic tool shape: adapters map it to their own tool contract. */
export interface AgentTool {
  name: string
  description: string
  inputSchema: AgentToolSchema
  mutates: boolean
  execute(input: unknown, context: AgentToolContext): Promise<AgentToolResult>
}
