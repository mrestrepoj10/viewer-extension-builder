import { parse } from 'acorn'
import type { Linter, Rule } from 'eslint'

import {
  type ExtensionFileName,
  type ExtensionFolder,
  extensionPaths,
  MAIN_CSS,
  MAIN_JS,
} from '@/lib/extensions/format'

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  file: ExtensionFileName
  line: number
  column: number
  severity: Severity
  rule: string
  message: string
  fix?: string
}

export interface CheckResult {
  diagnostics: Diagnostic[]
  errors: number
  warnings: number
  linted: boolean
}

type Node = Rule.Node
type NodeOf<T extends Node['type']> = Extract<Node, { type: T }>
type ClassNode = NodeOf<'ClassDeclaration'> | NodeOf<'ClassExpression'>
type FunctionNode =
  | NodeOf<'FunctionDeclaration'>
  | NodeOf<'FunctionExpression'>
  | NodeOf<'ArrowFunctionExpression'>

const EXTENSION_BASE = 'Autodesk.Viewing.Extension'
const PANEL_BASE = 'Autodesk.Viewing.UI.DockingPanel'
const REGISTER = 'theExtensionManager.registerExtension'

const syntaxHints: Array<[RegExp, string]> = [
  [
    /'import' and 'export' may appear only/,
    'main.js is a plain script: delete import/export; Autodesk and THREE are globals',
  ],
  [/await/, 'top-level await is not allowed in a script; await inside load() or an async method'],
  [
    /Unexpected (token|keyword)/,
    'look for a missing bracket, comma, or quote on this line or the one before',
  ],
]

export function checkSyntax(source: string): Diagnostic | null {
  try {
    parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true })
    return null
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    const loc: unknown = Reflect.get(error, 'loc')
    const line = typeof loc === 'object' && loc && 'line' in loc ? Number(loc.line) : 1
    const column = typeof loc === 'object' && loc && 'column' in loc ? Number(loc.column) + 1 : 1
    const message = error.message.replace(/\s*\(\d+:\d+\)$/, '')
    const hint = syntaxHints.find(([pattern]) => pattern.test(message))?.[1]
    return {
      file: MAIN_JS,
      line,
      column,
      severity: 'error',
      rule: 'syntax',
      message: `SyntaxError: ${message}`,
      fix: hint,
    }
  }
}

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

function textOf(context: Rule.RuleContext, node: Node | NodeOf<'Super'>): string {
  return compact(context.sourceCode.getText(node))
}

function isExtensionClass(context: Rule.RuleContext, node: ClassNode): boolean {
  return node.superClass !== null && node.superClass !== undefined
    ? textOf(context, node.superClass as Node) === EXTENSION_BASE
    : false
}

function methodsOf(node: ClassNode): Map<string, FunctionNode> {
  const methods = new Map<string, FunctionNode>()
  for (const member of node.body.body) {
    if (member.type !== 'MethodDefinition' || member.key.type !== 'Identifier') continue
    methods.set(member.key.name, member.value as FunctionNode)
  }
  return methods
}

function childNodes(node: Node): Node[] {
  const children: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    const items: unknown[] = Array.isArray(value) ? value : [value]
    for (const item of items) {
      if (item && typeof item === 'object' && 'type' in item && typeof item.type === 'string') {
        children.push(item as Node)
      }
    }
  }
  return children
}

function walk(node: Node, visit: (node: Node) => boolean | undefined) {
  if (visit(node) === false) return
  for (const child of childNodes(node)) walk(child, visit)
}

function isFunction(node: Node): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  )
}

function ownReturns(fn: FunctionNode): NodeOf<'ReturnStatement'>[] {
  const returns: NodeOf<'ReturnStatement'>[] = []
  walk(fn.body as Node, (node) => {
    if (isFunction(node)) return false
    if (node.type === 'ReturnStatement') returns.push(node)
    return true
  })
  return returns
}

function returnsTrue(node: NodeOf<'ReturnStatement'>): boolean {
  return node.argument?.type === 'Literal' && node.argument.value === true
}

const extensionClassRule: Rule.RuleModule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const classes: ClassNode[] = []
    const collect = (node: ClassNode) => {
      if (isExtensionClass(context, node)) classes.push(node)
    }
    return {
      ClassDeclaration: collect,
      ClassExpression: collect,
      'Program:exit'(program) {
        if (classes.length === 0) {
          context.report({
            node: program,
            loc: { line: 1, column: 0 },
            message: `no class extends ${EXTENSION_BASE} | fix: declare class <Id> extends ${EXTENSION_BASE}`,
          })
          return
        }
        for (const extra of classes.slice(1)) {
          context.report({
            node: extra,
            message:
              'a second Extension subclass; one extension per folder | fix: move it to its own extension',
          })
        }
        const target = classes[0]
        const methods = methodsOf(target)
        for (const name of ['load', 'unload']) {
          const method = methods.get(name)
          if (!method) {
            context.report({
              node: target.id ?? target,
              message: `${name}() is missing | fix: add ${name}() { ...; return true }`,
            })
            continue
          }
          const returns = ownReturns(method)
          if (method.async) {
            context.report({
              node: method,
              message: `async ${name}() returns a Promise, not true | fix: keep ${name}() synchronous and start async work inside it`,
            })
          } else if (!returns.some(returnsTrue)) {
            context.report({
              node: method,
              message: `${name}() never returns true; the viewer treats it as failed | fix: end ${name}() with return true`,
            })
          } else if (method.body.type === 'BlockStatement') {
            const last = method.body.body.at(-1)
            if (last?.type !== 'ReturnStatement' && last?.type !== 'ThrowStatement') {
              context.report({
                node: method,
                message: `${name}() can reach its end without returning true | fix: end ${name}() with return true`,
              })
            }
          }
        }
      },
    }
  },
}

function isTopLevelWrapper(fn: Node): boolean {
  const call = fn.parent
  if (!isFunction(fn) || fn.params.length > 0 || fn.async || fn.generator) return false
  if (call?.type !== 'CallExpression' || call.callee !== fn || call.arguments.length > 0) {
    return false
  }
  const statement = call.parent
  return statement?.type === 'ExpressionStatement' && statement.parent.type === 'Program'
}

function runsAtTopLevel(call: NodeOf<'CallExpression'>): boolean {
  const statement = call.parent
  if (statement.type !== 'ExpressionStatement') return false
  const container = statement.parent
  if (container.type === 'Program') return true
  return container.type === 'BlockStatement' && isTopLevelWrapper(container.parent)
}

const registerRule: Rule.RuleModule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const expected = String(context.settings.extensionId ?? '')
    const calls: NodeOf<'CallExpression'>[] = []
    let className: string | null = null
    const remember = (node: ClassNode) => {
      if (className === null && isExtensionClass(context, node) && node.id) className = node.id.name
    }
    return {
      ClassDeclaration: remember,
      ClassExpression: remember,
      CallExpression(node) {
        if (textOf(context, node.callee as Node).endsWith(REGISTER)) calls.push(node)
      },
      'Program:exit'(program) {
        if (calls.length === 0) {
          context.report({
            node: program,
            loc: { line: Math.max(1, context.sourceCode.lines.length), column: 0 },
            message: `the extension is never registered | fix: Autodesk.Viewing.theExtensionManager.registerExtension('${expected}', ${className ?? expected})`,
          })
          return
        }
        for (const extra of calls.slice(1)) {
          context.report({
            node: extra,
            message: 'registerExtension called twice | fix: keep a single registerExtension call',
          })
        }
        const call = calls[0]
        const [id, klass] = call.arguments
        if (id?.type !== 'Literal' || id.value !== expected) {
          context.report({
            node: (id as Node | undefined) ?? call,
            message: `the registered id must be '${expected}' to match config.json "name" | fix: registerExtension('${expected}', ...)`,
          })
        }
        if (className && (klass?.type !== 'Identifier' || klass.name !== className)) {
          context.report({
            node: (klass as Node | undefined) ?? call,
            message: `register the Extension subclass ${className} | fix: registerExtension('${expected}', ${className})`,
          })
        }
        if (!runsAtTopLevel(call)) {
          context.report({
            node: call,
            message:
              'registerExtension must run when the script runs | fix: call it at the top level of the script or of its (() => { ... })() wrapper',
          })
        }
      },
    }
  },
}

const plainScriptRule: Rule.RuleModule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      CallExpression(node) {
        const callee = textOf(context, node.callee as Node)
        if (callee === 'require') {
          context.report({
            node,
            message:
              'require() does not exist in the viewer page | fix: use the Autodesk and THREE globals or inline the code',
          })
        } else if (callee === 'eval' || callee === 'document.write') {
          context.report({
            node,
            message: `${callee}() is not allowed in an extension | fix: build DOM nodes with document.createElement`,
          })
        }
      },
      ImportExpression(node) {
        context.report({
          node,
          message:
            'dynamic import() pulls code the export cannot bundle | fix: keep everything in main.js',
        })
      },
    }
  },
}

interface Acquired {
  node: Node
  method: string
  call: string
  releaseHint: string
  released: (unload: ReleaseIndex) => boolean
}

interface ReleaseIndex {
  removedListeners: Set<string>
  removedControls: Set<string>
  calls: Set<string>
  text: string
}

function memberCall(context: Rule.RuleContext, node: NodeOf<'CallExpression'>) {
  if (node.callee.type !== 'MemberExpression' || node.callee.property.type !== 'Identifier') {
    return null
  }
  return {
    object: textOf(context, node.callee.object as Node),
    method: node.callee.property.name,
    args: node.arguments.map((argument) => textOf(context, argument as Node)),
  }
}

function releaseIndex(context: Rule.RuleContext, roots: FunctionNode[]): ReleaseIndex {
  const index: ReleaseIndex = {
    removedListeners: new Set(),
    removedControls: new Set(),
    calls: new Set(),
    text: roots.map((root) => textOf(context, root as Node)).join('\n'),
  }
  for (const root of roots) {
    walk(root.body as Node, (node) => {
      if (node.type !== 'CallExpression') return true
      const call = memberCall(context, node)
      if (!call) return true
      index.calls.add(`${call.method}(${call.args[0] ?? ''})`)
      if (call.method === 'removeEventListener') {
        index.removedListeners.add(`${call.object}|${call.args[0]}`)
      }
      if (call.method === 'removeControl') index.removedControls.add(call.args[0] ?? '')
      return true
    })
  }
  return index
}

function unloadRoots(methods: Map<string, FunctionNode>): FunctionNode[] {
  const unload = methods.get('unload')
  if (!unload) return []
  const seen = new Set<FunctionNode>([unload])
  const queue = [unload]
  while (queue.length > 0) {
    const current = queue.shift() as FunctionNode
    walk(current.body as Node, (node) => {
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'ThisExpression' &&
        node.callee.property.type === 'Identifier'
      ) {
        const helper = methods.get(node.callee.property.name)
        if (helper && !seen.has(helper)) {
          seen.add(helper)
          queue.push(helper)
        }
      }
      return true
    })
  }
  return [...seen]
}

const unloadCleanupRule: Rule.RuleModule = {
  meta: { type: 'suggestion', schema: [] },
  create(context) {
    const panelClasses = new Set<string>()
    let extensionClass: ClassNode | null = null
    const collect = (node: ClassNode) => {
      if (!node.superClass) return
      const base = textOf(context, node.superClass as Node)
      if (base === PANEL_BASE && node.id) panelClasses.add(node.id.name)
      if (base === EXTENSION_BASE && !extensionClass) extensionClass = node
    }
    return {
      ClassDeclaration: collect,
      ClassExpression: collect,
      'Program:exit'() {
        const target: ClassNode | null = extensionClass
        if (!target) return
        const methods = methodsOf(target)
        const roots = unloadRoots(methods)
        if (roots.length === 0) return
        const releasers = new Set(roots)
        const acquired: Acquired[] = []
        for (const [name, method] of methods) {
          if (releasers.has(method)) continue
          walk(method.body as Node, (node) => {
            if (node.type === 'NewExpression' && node.parent.type === 'AssignmentExpression') {
              const constructed = textOf(context, node.callee as Node)
              const isPanel = constructed === PANEL_BASE || panelClasses.has(constructed)
              const left = textOf(context, node.parent.left as Node)
              if (isPanel && left.startsWith('this.')) {
                acquired.push({
                  node,
                  method: name,
                  call: `${left} = new ${constructed}(…)`,
                  releaseHint: `${left}.uninitialize() (or setVisible(false))`,
                  released: (index) =>
                    index.text.includes(`${left}.uninitialize(`) ||
                    index.text.includes(`${left}.setVisible(false`),
                })
              }
            }
            if (node.type !== 'CallExpression') return true
            if (node.callee.type === 'Identifier' && node.callee.name === 'setInterval') {
              acquired.push({
                node,
                method: name,
                call: 'setInterval(…)',
                releaseHint: 'clearInterval(…)',
                released: (index) => index.text.includes('clearInterval('),
              })
              return true
            }
            const call = memberCall(context, node)
            if (!call) return true
            const [first = '', second] = call.args
            if (call.method === 'addEventListener') {
              const handler = node.arguments[1]
              if (
                handler &&
                (handler.type === 'ArrowFunctionExpression' ||
                  handler.type === 'FunctionExpression' ||
                  (second ?? '').endsWith('.bind(this)'))
              ) {
                context.report({
                  node,
                  message: `${call.object}.addEventListener(${first}, …) passes a new function, so removeEventListener can never remove it | fix: store the handler on this (this.onX = (e) => …) and pass the same reference to both`,
                })
              }
              acquired.push({
                node,
                method: name,
                call: `${call.object}.addEventListener(${first}, …)`,
                releaseHint: `${call.object}.removeEventListener(${first}, …)`,
                released: (index) => index.removedListeners.has(`${call.object}|${first}`),
              })
            } else if (call.method === 'addControl') {
              acquired.push({
                node,
                method: name,
                call: `${call.object}.addControl(${first})`,
                releaseHint: `${call.object}.removeControl(${first})`,
                released: (index) =>
                  index.removedControls.has(first) || index.removedControls.has(call.object),
              })
            } else if (call.method === 'registerTool' || call.method === 'activateTool') {
              const undo = call.method === 'registerTool' ? 'deregisterTool' : 'deactivateTool'
              acquired.push({
                node,
                method: name,
                call: `${call.object}.${call.method}(${first})`,
                releaseHint: `${call.object}.${undo}(${first})`,
                released: (index) => index.calls.has(`${undo}(${first})`),
              })
            }
            return true
          })
        }
        const index = releaseIndex(context, roots)
        for (const item of acquired) {
          if (item.released(index)) continue
          context.report({
            node: item.node,
            message: `${item.call} in ${item.method}() is not undone in unload() | fix: call ${item.releaseHint} in unload()`,
          })
        }
      },
    }
  },
}

export const VIEWER_RULES = {
  'extension-class': extensionClassRule,
  'register-extension': registerRule,
  'plain-script': plainScriptRule,
  'unload-cleanup': unloadCleanupRule,
} satisfies Record<string, Rule.RuleModule>

const CORE_RULES: Linter.RulesRecord = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-dupe-class-members': 'error',
  'no-dupe-keys': 'error',
  'no-const-assign': 'error',
  'no-unreachable': 'warn',
  'getter-return': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'constructor-super': 'error',
  'no-this-before-super': 'error',
  'no-async-promise-executor': 'error',
  'no-unsafe-finally': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'warn',
}

type LinterModule = typeof import('eslint-linter-browserify')
interface LintRuntime {
  Linter: LinterModule['Linter']
  browser: Record<string, boolean>
}

let lintRuntime: Promise<LintRuntime> | null = null

function loadLintRuntime(): Promise<LintRuntime> {
  if (!lintRuntime) {
    const pending = Promise.all([import('eslint-linter-browserify'), import('globals')]).then(
      ([linter, globals]) => ({ Linter: linter.Linter, browser: globals.default.browser }),
    )
    lintRuntime = pending
    pending.catch(() => {
      if (lintRuntime === pending) lintRuntime = null
    })
  }
  return lintRuntime
}

export async function lintScript(source: string, extensionId: string): Promise<Diagnostic[]> {
  const { Linter, browser } = await loadLintRuntime()
  const linter = new Linter({ configType: 'flat' })
  const viewerRules: Linter.RulesRecord = {
    'viewer/extension-class': 'error',
    'viewer/register-extension': 'error',
    'viewer/plain-script': 'error',
    'viewer/unload-cleanup': 'warn',
  }
  const config: Linter.Config = {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...browser, Autodesk: 'readonly', THREE: 'readonly' },
    },
    plugins: { viewer: { rules: VIEWER_RULES } },
    settings: { extensionId },
    rules: { ...CORE_RULES, ...viewerRules },
  }
  const messages = linter.verify(source, [config], { filename: MAIN_JS })
  return messages.map((message) => {
    const [text, fix] = message.message.split(' | fix: ')
    return {
      file: MAIN_JS,
      line: message.line || 1,
      column: message.column || 1,
      severity: message.severity === 2 ? 'error' : 'warning',
      rule: message.ruleId ?? (message.fatal ? 'syntax' : 'eslint'),
      message: text,
      fix,
    }
  })
}

function configDiagnostics(folder: ExtensionFolder): Diagnostic[] {
  const diagnostics: Diagnostic[] = folder.parsed.problems.map((problem) => ({
    file: 'config.json',
    line: problem.line,
    column: problem.column,
    severity: 'error',
    rule: 'config',
    message: problem.message,
  }))
  const config = folder.parsed.config
  if (config?.filestoload.cssfiles.includes(MAIN_CSS) && folder.mainCss === null) {
    diagnostics.push({
      file: 'config.json',
      line: 1,
      column: 1,
      severity: 'error',
      rule: 'config',
      message: `config.json lists ${MAIN_CSS} but ${extensionPaths(folder.id).css} is missing`,
      fix: `create contents/${MAIN_CSS} or set "cssfiles": []`,
    })
  }
  return diagnostics
}

function summarize(diagnostics: Diagnostic[], linted: boolean): CheckResult {
  const sorted = [...diagnostics].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.rule.localeCompare(b.rule),
  )
  const errors = sorted.filter((item) => item.severity === 'error').length
  return { diagnostics: sorted, errors, warnings: sorted.length - errors, linted }
}

export async function checkExtensionFolder(
  folder: ExtensionFolder,
  options: { lint?: boolean } = {},
): Promise<CheckResult> {
  const diagnostics = configDiagnostics(folder)
  if (folder.mainJs === null) {
    diagnostics.push({
      file: MAIN_JS,
      line: 1,
      column: 1,
      severity: 'error',
      rule: 'missing',
      message: `${extensionPaths(folder.id).main} is missing`,
    })
    return summarize(diagnostics, false)
  }
  const syntax = checkSyntax(folder.mainJs)
  if (syntax) return summarize([...diagnostics, syntax], false)
  if (options.lint === false) return summarize(diagnostics, false)
  diagnostics.push(...(await lintScript(folder.mainJs, folder.id)))
  return summarize(diagnostics, true)
}

export function codeFrame(source: string, line: number, column: number): string {
  const lines = source.split('\n')
  const text = lines[line - 1]
  if (text === undefined) return ''
  const gutter = String(line).length + 2
  const shown = text.length > 120 ? `${text.slice(0, 117)}...` : text
  const caret = ' '.repeat(Math.max(0, Math.min(column - 1, shown.length)))
  return `${String(line).padStart(gutter)} | ${shown}\n${' '.repeat(gutter)} | ${caret}^`
}

const MAX_FRAMES = 12

export function formatDiagnostics(
  diagnostics: readonly Diagnostic[],
  sources: Partial<Record<ExtensionFileName, string | null>>,
): string {
  return diagnostics
    .map((item, index) => {
      const head = `${item.file}:${item.line}:${item.column} ${item.severity} ${item.rule} ${item.message}`
      const fix = item.fix ? `\n    fix: ${item.fix}` : ''
      const source = sources[item.file]
      const frame = source && index < MAX_FRAMES ? codeFrame(source, item.line, item.column) : ''
      return `${head}${fix}${frame ? `\n${frame}` : ''}`
    })
    .join('\n')
}

export const UNLOAD_CLEANUP_LIMITS =
  'viewer/unload-cleanup is a text heuristic: it pairs each addEventListener/addControl/registerTool/activateTool/DockingPanel/setInterval in the extension class with a matching remove call (same object and argument text) in unload() or the this.helpers unload() calls. It does not follow other functions, aliases, or loops; ext unload reports what the live viewer still holds.'
