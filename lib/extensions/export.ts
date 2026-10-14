import { strToU8, zipSync } from 'fflate'

import { type ExtensionSource, MAIN_CSS, MAIN_JS, stringifyConfig } from '@/lib/extensions/format'

const FIXED_DATE = new Date(2026, 0, 1)

export function loadMarkdown(source: ExtensionSource): string {
  const { id, config } = source
  const files = [`${id}/config.json`, `${id}/contents/${MAIN_JS}`]
  if (source.mainCss !== null) files.push(`${id}/contents/${MAIN_CSS}`)
  const entry = JSON.stringify(config, null, 2)
  const css = source.mainCss !== null
  return `# ${config.displayname}

${config.description}

Autodesk Platform Services Viewer v7 extension \`${id}\`, in the folder format of
https://github.com/autodesk-platform-services/aps-extensions.

## Files

${files.map((file) => `- \`${file}\``).join('\n')}

## Load it in any Viewer v7 page

Include the files after the viewer script, then load the extension on a viewer:

\`\`\`html
<link rel="stylesheet" href="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css">
<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js"></script>
${css ? `<link rel="stylesheet" href="${id}/contents/${MAIN_CSS}">\n` : ''}<script src="${id}/contents/${MAIN_JS}"></script>
\`\`\`

\`\`\`js
await viewer.loadExtension('${id}')
// later, to remove its toolbar buttons and panels:
viewer.unloadExtension('${id}')
\`\`\`

Or list it when the viewer starts:

\`\`\`js
const viewer = new Autodesk.Viewing.GuiViewer3D(container, { extensions: ['${id}'] })
\`\`\`

## Drop it into aps-extensions

1. Copy the \`${id}\` folder into \`public/extensions/\`.
2. Add this entry to the \`Extensions\` array in \`public/extensions/config.json\`:

\`\`\`json
${entry}
\`\`\`

3. Restart the sample; the extension loader picks it up from the list.
`
}

export function buildExtensionZip(source: ExtensionSource): Uint8Array {
  const { id } = source
  const entries: Record<string, Uint8Array> = {
    [`${id}/LOAD.md`]: strToU8(loadMarkdown(source)),
    [`${id}/config.json`]: strToU8(
      source.configText.trim() ? source.configText : stringifyConfig(source.config),
    ),
    [`${id}/contents/${MAIN_JS}`]: strToU8(source.mainJs),
  }
  if (source.mainCss !== null) entries[`${id}/contents/${MAIN_CSS}`] = strToU8(source.mainCss)
  return zipSync(entries, { level: 6, mtime: FIXED_DATE })
}

export function zipFileName(id: string): string {
  return `${id}.zip`
}

/** Page-side only: a just-bash command cannot start a download itself. */
export function downloadBytes(fileName: string, bytes: Uint8Array, type = 'application/zip') {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
