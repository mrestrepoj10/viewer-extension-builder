declare module 'libfx/browser' {
  export type MaybePromise<T> = T | Promise<T>
  export type Bytes = ArrayBuffer | ArrayBufferView
  export type WasmSource =
    | string
    | URL
    | Response
    | Bytes
    | WebAssembly.Module
    | Promise<Response | Bytes | WebAssembly.Module>

  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

  export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

  /** `data` is base64; omit it and pass `sourceRef` for a host-owned original. */
  export interface ToolImage {
    type: 'image'
    mimeType: ImageMimeType
    data?: string
    sourceRef?: string
  }

  /** At most 8 images, each up to 5 MiB of base64. The model reads `text` and sees the images. */
  export interface RichToolResult {
    type: 'libfx.tool-result'
    text: string
    images: ToolImage[]
    isError?: boolean
  }

  /** Strings return as text, other JSON is encoded, and `undefined` becomes `"null"`. */
  export type HostToolResult = JsonValue | undefined | RichToolResult

  export interface HostToolContext {
    signal: AbortSignal
  }

  /** A thrown error becomes a failed tool result carrying its message. */
  export interface HostTool {
    name: string
    description: string
    inputSchema: { [key: string]: JsonValue }
    execute(input: unknown, context: HostToolContext): MaybePromise<HostToolResult>
  }

  export interface ProviderTool {
    name: 'web_search'
    providerExecuted: true
  }

  /** `timestamp` is `performance.now()` milliseconds; the other fields vary by `type`. */
  export interface DiagnosticEvent {
    type: string
    timestamp: number
    [detail: string]: JsonValue | undefined
  }

  export interface ModelOptions {
    id: string
    effort?: string
    fast?: boolean
    ultrafast?: boolean
  }

  export interface ResizeImageInput {
    bytes: Uint8Array
    mimeType: string
  }

  export interface ResizeImageOutput {
    bytes: Bytes
    mimeType: string
  }

  export interface AgentOptions {
    apiKey: string
    /** A model object cannot be combined with the deprecated top-level effort, fast, or ultrafast. */
    model?: string | ModelOptions
    effort?: string
    fast?: boolean
    ultrafast?: boolean
    instructions?: string | string[]
    tools?: (HostTool | ProviderTool)[]
    checkpoint?: Bytes
    fetch?: typeof globalThis.fetch
    onEvent?: (event: DiagnosticEvent) => void
    resizeImage?: (image: ResizeImageInput) => MaybePromise<ResizeImageOutput>
    wasm?: WasmSource
  }

  export type PromptBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string | Bytes; mimeType: ImageMimeType; sourceRef?: string }
    | { type: 'image'; data: Blob; mimeType?: ImageMimeType; sourceRef?: string }
    | { type: 'image'; mimeType: ImageMimeType; sourceRef: string }
    | { type: 'resource'; resource: { uri: string; text?: string } }

  export type PromptInput = string | PromptBlock[]

  export interface PromptOptions {
    signal?: AbortSignal
  }

  export interface TextDeltaEvent {
    type: 'text_delta'
    delta: string
  }

  export interface ReasoningDeltaEvent {
    type: 'reasoning_delta'
    delta: string
  }

  /** Steering text entered the conversation. */
  export interface UserMessageEvent {
    type: 'user_message'
    text: string
  }

  /** Inputs above 64 KiB arrive as `inputPreview` with `inputTruncated: true`. */
  export interface ToolStartEvent {
    type: 'tool_start'
    id: string
    name: string
    input?: unknown
    inputPreview?: string
    inputTruncated?: boolean
  }

  /** `content` is the text result only, without images. */
  export interface ToolEndEvent {
    type: 'tool_end'
    id: string
    name: string
    content?: string
    isError: boolean
  }

  export type TurnEvent =
    | TextDeltaEvent
    | ReasoningDeltaEvent
    | UserMessageEvent
    | ToolStartEvent
    | ToolEndEvent

  export type StopReason =
    | 'end_turn'
    | 'max_output_tokens'
    | 'max_model_turns'
    | 'refused'
    | 'cancelled'

  /** Missing counts are omitted, never zero-filled. */
  export interface Usage {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }

  export interface TurnResult {
    stopReason: StopReason
    usage: Usage
  }

  export type SteerInput = string | { type: 'text'; text: string }[]

  /** One consumer only: read every event, then await `result`. Breaking out of the loop cancels. */
  export interface Turn extends AsyncIterable<TurnEvent> {
    result: Promise<TurnResult>
    steer(input: SteerInput): Promise<void>
    cancel(): void
  }

  export interface Agent {
    /** Throws synchronously for invalid input, a closed agent, or another active prompt. */
    prompt(input: PromptInput, options?: PromptOptions): Turn
    /** Idle only; opaque bytes of at most 4 MiB. */
    checkpoint(): Promise<Uint8Array>
    close(): Promise<void>
  }

  export interface ListModelsOptions {
    apiKey: string
    fetch?: typeof globalThis.fetch
  }

  export interface TerminalSize {
    cols: number
    rows: number
  }

  export interface TerminalAdapter {
    readonly cols: number
    readonly rows: number
    write(bytes: Uint8Array): void
    onData(callback: (data: string) => void): () => void
    /** Read `cols` and `rows` again when this fires. */
    onResize(callback: () => void): () => void
    onKeyData?(callback: (data: string) => void): () => void
    drain?(): MaybePromise<void>
  }

  export interface XtermDisposable {
    dispose(): void
  }

  /** The members of an `@xterm/xterm` Terminal that `xtermAdapter` reads. */
  export interface XtermTerminal {
    readonly cols: number
    readonly rows: number
    readonly element?: HTMLElement | undefined
    write(data: string | Uint8Array): void
    onData(listener: (data: string) => void): XtermDisposable
    onResize(listener: (size: TerminalSize) => void): XtermDisposable
    attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void
    hasSelection?(): boolean
  }

  export interface WorkspaceInfo {
    version: 1
    root: string
    /** Must equal `root`. */
    cwd: string
    home: string
    gitAvailable: false
    ephemeral: true
  }

  export interface WorkspaceExecRequest {
    command: string
    cwd: string
    signal: AbortSignal
    timeoutMs: number
    outputLimitBytes: number
  }

  export interface WorkspaceExecResult {
    stdout: string
    stderr: string
    exitCode: number
  }

  /** Adds the completion-only `shell.run` tool. Paths are normalized and absolute. */
  export interface WorkspaceAdapter {
    info: WorkspaceInfo
    permission: 'allow-sandboxed' | 'prompt'
    exec(request: WorkspaceExecRequest): MaybePromise<WorkspaceExecResult>
  }

  export interface ConfigStore {
    get(id: string): MaybePromise<string | null>
    set(id: string, value: string): MaybePromise<void>
  }

  export type PromptHistoryAppendResult = undefined | 'duplicate' | 'record_too_large'

  export interface PromptHistoryStore {
    /** Oldest first. */
    load(workspaceRoot: string, limit: number): MaybePromise<string[]>
    append(
      workspaceRoot: string,
      value: string,
      timestampMs: number,
    ): MaybePromise<PromptHistoryAppendResult>
    clear(workspaceRoot: string): MaybePromise<void>
  }

  export interface StoredRecord {
    bytes: Uint8Array
    revision: string
  }

  export interface StoredRevision {
    revision: string
  }

  export interface SessionSummary {
    id: string
    updatedAtMs: number
  }

  /** Throw an error with `code: 'FX_SESSION_REVISION_CONFLICT'` on a stale `expectedRevision`. */
  export interface SessionStore {
    load(id: string): MaybePromise<StoredRecord | null>
    commit(
      id: string,
      bytes: Uint8Array,
      expectedRevision: string | undefined,
    ): MaybePromise<StoredRevision>
    list(): MaybePromise<SessionSummary[]>
    remove(id: string): MaybePromise<void>
  }

  /** Throw an error with `code: 'FX_OAUTH_SESSION_REVISION_CONFLICT'` on a stale revision. */
  export interface OAuthSessionStore {
    load(): MaybePromise<StoredRecord | null>
    commit(bytes: Uint8Array, expectedRevision: string | undefined): MaybePromise<StoredRevision>
    remove(expectedRevision: string | undefined): MaybePromise<undefined | boolean | 'missing'>
  }

  export interface TerminalOptions {
    terminal: TerminalAdapter
    wasm?: WasmSource
    env?: { [name: string]: string }
    args?: string[]
    fetch?: typeof globalThis.fetch
    onEvent?: (event: DiagnosticEvent) => void
    /** `''` disables interrupt detection. Defaults to Ctrl+C. */
    interruptKey?: string
    configStore?: ConfigStore
    promptHistoryStore?: PromptHistoryStore
    sessionStore?: SessionStore
    oauthSessionStore?: OAuthSessionStore
    openUrl?: (url: string) => MaybePromise<boolean>
    workspace?: WorkspaceAdapter
  }

  export interface TerminalRuntime {
    /** Resolves once fx reaches its input loop; send input only after that. */
    interactive: Promise<void>
    /** Resolves with the exit code; an explicit abort exits with 130. */
    exited: Promise<number>
    write(data: string | Uint8Array): void
    resize(): void
    abort(): void
  }

  export function supportsJspi(): boolean
  export function createFxAgent(options: AgentOptions): Promise<Agent>
  export function listModels(options: ListModelsOptions): Promise<string[]>
  export function createFxTerminal(options: TerminalOptions): Promise<TerminalRuntime>
  export function xtermAdapter(terminal: XtermTerminal): TerminalAdapter
  export function encodeXtermKeyEvent(event: KeyboardEvent): string | null
  export const fxSdkApiVersion: number
  export const libfxApiVersion: number
}
