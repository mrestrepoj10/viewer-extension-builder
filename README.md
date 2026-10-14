# Viewer Extension Builder

Describe an Autodesk Viewer extension in plain words; the fx agent writes it, loads it live, and hands you the files. The app is built on top of [cantera](https://github.com/mrestrepoj10/cantera) ([canteraui.vercel.app](https://canteraui.vercel.app)), the shadcn registry for construction UI: it installs the `@cantera/viewer-agent` template, an already-translated model in a full-bleed Autodesk Viewer with the fx coding agent docked beside it as a terminal, and grows it into an extension builder.

Status: scaffold. Today the app is the viewer-agent template running on `openai/gpt-6.1-sol` at low effort; the extension-building flow is not written yet.

## Environment

Copy `.env.example` to `.env.local` and fill in every key.

| Key | Required | Meaning |
| --- | --- | --- |
| `APS_CLIENT_ID` | yes | Client ID of your APS app (aps.autodesk.com). |
| `APS_CLIENT_SECRET` | yes | Client secret of the same APS app. |
| `APS_MODEL_URN` | yes | Base64 Model Derivative URN of a model Autodesk has already translated, with or without the `urn:` prefix. |
| `AI_GATEWAY_API_KEY` | yes | Vercel AI Gateway key, held by the `/api/agent/gateway` proxy route and never sent to the browser. Only the model in `lib/agent-model.ts` is allowed through. |

## Run

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. The home route redirects to `/agent`. fx runs in the browser on libfx (WebAssembly with JSPI), so use Chrome or Edge 137+ or Safari 27+.

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server. |
| `pnpm build` | Production build. |
| `pnpm lint` | Next's ESLint config. |
| `pnpm check` | Biome lint and format check. |
| `pnpm format` | Biome format, in place. |

Biome formats everything except the shadcn primitives in `components/ui/` and `lib/utils.ts`, which the shadcn CLI owns and rewrites on `add --overwrite`.

## Model

`lib/agent-model.ts` names the one model the terminal asks for and the gateway route lets through, with its effort and speed. Change it there; the page and the route both read it.

## Updating cantera code

The registry code lives where the shadcn CLI put it (`app/agent`, `app/api`, `components/`, `lib/`). Pull a newer version with:

```sh
pnpm dlx shadcn@latest add @cantera/viewer-agent -o
```

That overwrites local edits to those files. This repo changes `components/viewer-agent.tsx`, `components/ui/fx-terminal/`, `app/agent/page.tsx`, and the gateway route to thread the model, effort, and speed through, so review the diff after an update.

## License

MIT
