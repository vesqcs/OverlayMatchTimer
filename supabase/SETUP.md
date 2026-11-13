# Owner setup — optional kickoff sync (v1.7.0)

Sync is **off by default**. Nothing in the zip talks to Supabase until a user turns the Customize toggle on and enters credentials.

## What to create (once)

1. Create a **dedicated** Supabase project for Overlay MatchTimer (recommended: separate from production apps).
2. In the SQL editor, run `supabase/migrations/20261113120000_kickoff_sync.sql`.
3. Project Settings → API: copy **Project URL** and the **anon public** key.
4. Each colleague: Customize → **Kickoff sync** → paste URL + anon key → turn the toggle **On** (Chrome will ask for host permission for that project origin).
5. Open the same match page (or set the same optional **Room id**). Setting Kick-off / nudging offset publishes; others pull within a few seconds.

## Notes

- Never put the service-role key in the extension. Anon + RLS only.
- Do not commit URL or keys to git.
- Anyone with the anon key can read/write every row in that project’s `kickoff_sync` table — treat the project as a shared team room, not a public multi-tenant API.
