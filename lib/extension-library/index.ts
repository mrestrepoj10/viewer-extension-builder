import { DOCS_FILES } from '@/lib/extension-library/generated/docs-files'
import { EXTENSION_FILES } from '@/lib/extension-library/generated/extension-files'
import { SKILL_INSTRUCTIONS } from '@/lib/extension-library/generated/skill'

export { SKILL_INSTRUCTIONS }

export const DOCS_ROOT = '/docs'
export const DOCS_INDEX_PATH = '/docs/INDEX.txt'
export const EXTENSIONS_ROOT = '/model/extensions'

/** Read-only reference content for the fx workspace, keyed by absolute workspace path. */
export const WORKSPACE_FILES: Readonly<Record<string, string>> = {
  ...DOCS_FILES,
  ...EXTENSION_FILES,
}

/** The reference extensions the agent copies from (`ext new <Id> --from <Example>`). */
export const REFERENCE_EXTENSIONS: readonly string[] = [
  ...new Set(
    Object.keys(EXTENSION_FILES).map(
      (path) => path.slice(EXTENSIONS_ROOT.length + 1).split('/')[0],
    ),
  ),
]
