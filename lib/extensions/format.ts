export const EXTENSIONS_DIR = '/model/extensions'
export const EXPORTS_DIR = '/model/exports'
export const MAIN_JS = 'main.js'
export const MAIN_CSS = 'main.css'
export const EXTENSION_ID_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export type ExtensionFileName = 'config.json' | 'main.js' | 'main.css'

export interface ExtensionConfig {
  name: string
  displayname: string
  description: string
  options: Record<string, unknown>
  viewerversion?: string
  loadonstartup: 'true' | 'false'
  filestoload: { cssfiles: string[]; jsfiles: string[] }
  includeinlist?: string
  [field: string]: unknown
}

export interface ExtensionSource {
  id: string
  config: ExtensionConfig
  configText: string
  mainJs: string
  mainCss: string | null
}

export interface ConfigProblem {
  line: number
  column: number
  message: string
}

export interface ParsedConfig {
  config: ExtensionConfig | null
  problems: ConfigProblem[]
}

/** The slice of the workspace file system the extension helpers read and write. */
export interface ExtensionFs {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  readdir(path: string): Promise<string[]>
}

export class ExtensionFormatError extends Error {}

export function extensionPaths(id: string) {
  const dir = `${EXTENSIONS_DIR}/${id}`
  return {
    dir,
    config: `${dir}/config.json`,
    contents: `${dir}/contents`,
    main: `${dir}/contents/${MAIN_JS}`,
    css: `${dir}/contents/${MAIN_CSS}`,
  }
}

export function sourceUrlFor(id: string, file: string = MAIN_JS): string {
  return `ext/${id}/${file}`
}

export function assertExtensionId(id: string | undefined): string {
  if (!id) throw new ExtensionFormatError('give an extension id, e.g. LevelPanel')
  if (!EXTENSION_ID_PATTERN.test(id)) {
    throw new ExtensionFormatError(
      `"${id}" is not a valid id: use letters, digits, and _ starting with a letter (it is also the class name)`,
    )
  }
  return id
}

export function displayNameFor(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

export function kebabNameFor(id: string): string {
  return displayNameFor(id).toLowerCase().replace(/\s+/g, '-')
}

export function defaultConfig(id: string, description: string): ExtensionConfig {
  return {
    name: id,
    displayname: displayNameFor(id),
    description,
    options: {},
    viewerversion: '7.*',
    loadonstartup: 'false',
    filestoload: { cssfiles: [MAIN_CSS], jsfiles: [MAIN_JS] },
    includeinlist: 'true',
  }
}

export function stringifyConfig(config: ExtensionConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function locate(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function lineOf(text: string, needle: string): { line: number; column: number } {
  const offset = text.indexOf(needle)
  return offset < 0 ? { line: 1, column: 1 } : locate(text, offset)
}

function jsonErrorLocation(text: string, error: unknown): { line: number; column: number } {
  const message = error instanceof Error ? error.message : ''
  const lineColumn = /line (\d+) column (\d+)/.exec(message)
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  const position = /position (\d+)/.exec(message)
  if (position) return locate(text, Number(position[1]))
  return { line: 1, column: 1 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

export function parseExtensionConfig(text: string, folderId: string): ParsedConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const where = jsonErrorLocation(text, error)
    const detail = error instanceof Error ? error.message.replace(/\s*\(line.*$/, '') : 'invalid'
    return { config: null, problems: [{ ...where, message: `invalid JSON: ${detail}` }] }
  }
  if (!isRecord(raw)) {
    return { config: null, problems: [{ line: 1, column: 1, message: 'must be a JSON object' }] }
  }
  const problems: ConfigProblem[] = []
  const problem = (field: string, message: string) =>
    problems.push({ ...lineOf(text, `"${field}"`), message })

  if (raw.name !== folderId) {
    problem(
      'name',
      `"name" must equal the folder name "${folderId}" (got ${JSON.stringify(raw.name)})`,
    )
  }
  for (const field of ['displayname', 'description'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') {
      problem(field, `"${field}" must be a non-empty string`)
    }
  }
  if (raw.loadonstartup !== 'true' && raw.loadonstartup !== 'false') {
    problem('loadonstartup', '"loadonstartup" must be the string "true" or "false"')
  }
  if (raw.options !== undefined && !isRecord(raw.options)) {
    problem('options', '"options" must be an object (it is passed to the constructor)')
  }
  const files = isRecord(raw.filestoload) ? raw.filestoload : null
  const jsfiles = files ? stringList(files.jsfiles) : [MAIN_JS]
  const cssfiles = files ? stringList(files.cssfiles ?? []) : [MAIN_CSS]
  if (raw.filestoload !== undefined && !files) {
    problem('filestoload', '"filestoload" must be {"cssfiles": [...], "jsfiles": [...]}')
  }
  if (jsfiles?.length !== 1 || jsfiles[0] !== MAIN_JS) {
    problem('jsfiles', `"filestoload.jsfiles" must be ["${MAIN_JS}"]: one script per extension`)
  }
  if (!cssfiles || cssfiles.some((file) => file !== MAIN_CSS)) {
    problem('cssfiles', `"filestoload.cssfiles" must be [] or ["${MAIN_CSS}"]`)
  }
  if (problems.length > 0) return { config: null, problems }
  const config: ExtensionConfig = {
    ...raw,
    name: folderId,
    displayname: String(raw.displayname),
    description: String(raw.description),
    options: isRecord(raw.options) ? raw.options : {},
    loadonstartup: raw.loadonstartup === 'true' ? 'true' : 'false',
    filestoload: { cssfiles: cssfiles ?? [], jsfiles: jsfiles ?? [MAIN_JS] },
  }
  return { config, problems }
}

export async function listExtensionIds(fs: ExtensionFs): Promise<string[]> {
  if (!(await fs.exists(EXTENSIONS_DIR))) return []
  const entries = await fs.readdir(EXTENSIONS_DIR)
  const ids: string[] = []
  for (const entry of entries) {
    if (await fs.exists(extensionPaths(entry).config)) ids.push(entry)
  }
  return ids.sort((a, b) => a.localeCompare(b, 'en'))
}

export interface ExtensionFolder {
  id: string
  configText: string
  parsed: ParsedConfig
  mainJs: string | null
  mainCss: string | null
}

export async function readExtensionFolder(fs: ExtensionFs, id: string): Promise<ExtensionFolder> {
  const paths = extensionPaths(id)
  if (!(await fs.exists(paths.dir))) {
    const known = await listExtensionIds(fs)
    throw new ExtensionFormatError(
      `no extension ${id} under ${EXTENSIONS_DIR} (have: ${known.join(', ') || 'none'}); ext new ${id} creates it`,
    )
  }
  if (!(await fs.exists(paths.config))) {
    throw new ExtensionFormatError(`${paths.config} is missing`)
  }
  const configText = await fs.readFile(paths.config)
  return {
    id,
    configText,
    parsed: parseExtensionConfig(configText, id),
    mainJs: (await fs.exists(paths.main)) ? await fs.readFile(paths.main) : null,
    mainCss: (await fs.exists(paths.css)) ? await fs.readFile(paths.css) : null,
  }
}

export function toExtensionSource(folder: ExtensionFolder): ExtensionSource {
  const { config } = folder.parsed
  if (!config) {
    throw new ExtensionFormatError(`config.json is invalid; run ext check ${folder.id}`)
  }
  if (folder.mainJs === null) {
    throw new ExtensionFormatError(`${extensionPaths(folder.id).main} is missing`)
  }
  const wantsCss = config.filestoload.cssfiles.includes(MAIN_CSS)
  return {
    id: folder.id,
    config,
    configText: folder.configText,
    mainJs: folder.mainJs,
    mainCss: wantsCss ? folder.mainCss : null,
  }
}
