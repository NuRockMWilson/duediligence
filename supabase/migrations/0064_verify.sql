-- Verify: nurock_schedule_formats has a PUBLIC ALL policy (no roles / TO clause)
SELECT polname, polcmd, polroles::regrole[] AS roles,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'nurock_schedule_formats'::regclass;

-- Sanity: current formats and their line counts (buildable = has lines)
SELECT f.slug, f.name, f.is_default, f.sort_order,
       count(sl.id) AS line_count
FROM nurock_schedule_formats f
LEFT JOIN nurock_standard_schedule_lines sl ON sl.format_id = f.id
GROUP BY f.id, f.slug, f.name, f.is_default, f.sort_order
ORDER BY f.sort_order;
