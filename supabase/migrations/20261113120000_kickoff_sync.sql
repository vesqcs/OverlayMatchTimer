-- Overlay MatchTimer — optional kickoff / clock-reference sync (v1.7.0)
-- Do NOT run automatically from the extension. Owner applies this in their own
-- Supabase project SQL editor (or CLI) when they choose to enable team sync.
--
-- Table holds one row per match room. Colleagues share the same project URL +
-- anon key (entered in the extension Customize popup; never baked into the zip).

create table if not exists public.kickoff_sync (
  match_key text primary key,
  kickoff1 double precision null,
  kickoff2 double precision null,
  kickoff_c1 double precision null,
  kickoff_c2 double precision null,
  custom_min_c1 text null,
  custom_min_c2 text null,
  half text null,
  updated_at timestamptz not null default now(),
  client_id text null
);

comment on table public.kickoff_sync is
  'Shared kickoff / clock reference for Overlay MatchTimer. One row per match_key.';

create index if not exists kickoff_sync_updated_at_idx
  on public.kickoff_sync (updated_at desc);

alter table public.kickoff_sync enable row level security;

-- Team tool: shared anon key can read/write all rows in THIS project.
-- Restrict by rotating the anon key / using a dedicated project if needed.
drop policy if exists "kickoff_sync_anon_select" on public.kickoff_sync;
create policy "kickoff_sync_anon_select"
  on public.kickoff_sync
  for select
  to anon
  using (true);

drop policy if exists "kickoff_sync_anon_insert" on public.kickoff_sync;
create policy "kickoff_sync_anon_insert"
  on public.kickoff_sync
  for insert
  to anon
  with check (true);

drop policy if exists "kickoff_sync_anon_update" on public.kickoff_sync;
create policy "kickoff_sync_anon_update"
  on public.kickoff_sync
  for update
  to anon
  using (true)
  with check (true);

-- PostgREST upsert needs GRANT for anon role
grant select, insert, update on table public.kickoff_sync to anon;
