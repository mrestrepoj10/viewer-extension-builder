import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set; add it to .env.local or the environment')
  process.exit(1)
}

const sql = neon(url)

// Millisecond timestamps keep the created_at pagination cursor exact through a JS Date.
const statements = [
  `create table if not exists extensions (
    id text primary key,
    title text not null,
    description text not null default '',
    author text not null default 'anonymous',
    extension_id text not null,
    prompt text,
    model text not null,
    files_url text not null,
    main_js_url text not null,
    main_css_url text,
    config_json jsonb not null,
    thumbnail_url text not null,
    edit_token_hash text not null,
    created_at timestamptz not null default date_trunc('milliseconds', now())
  )`,
  'create index if not exists extensions_created_at_id on extensions (created_at desc, id desc)',
]

for (const statement of statements) await sql.query(statement)
const [{ count }] = await sql.query('select count(*)::int as count from extensions')
console.log(`extensions table ready (${count} rows)`)
