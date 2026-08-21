-- Apply to production only after the hardened Next.js deployment is live.
-- The server-side route retains access through drainly_system.

REVOKE EXECUTE ON FUNCTION api.marketplace_match_preview(
  text,
  domain.tank_tier,
  domain.timing_kind,
  date
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION api.marketplace_match_preview(
  text,
  domain.tank_tier,
  domain.timing_kind,
  date
) TO drainly_system;