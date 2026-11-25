-- DRAFT ONLY. Not a migration. Do not apply from CI or agents.
-- Intended for a real Supabase project only when Kickoff sync is re-enabled.
-- Adapt table/column names to the then-current schema before running.
-- Requires pg_cron (or equivalent) and a privileged role; anon must still have no DELETE.

-- Example: delete shared match timer rows idle for more than ~48 hours.
-- Prototype table name was kickoff_sync; replace if the production migration renames it.

CREATE OR REPLACE FUNCTION public.cleanup_old_match_timers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.kickoff_sync
  WHERE updated_at < (now() - interval '48 hours');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Schedule once per day (adjust schedule / job name as needed).
-- Uncomment after confirming pg_cron is available and the function above is correct:
--
-- SELECT cron.schedule(
--   'cleanup-old-match-timers',
--   '15 3 * * *',
--   $$SELECT public.cleanup_old_match_timers();$$
-- );
