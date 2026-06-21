-- ============================================================
-- ONTOLOGY CACHE MATERIALIZED VIEWS
-- (Component 2C)
--
-- Loaded by the ontology-db service after the base schema via
-- /docker-entrypoint-initdb.d/02-views.sql. Refresh on a schedule as the
-- underlying tables are synced.
-- ============================================================

CREATE MATERIALIZED VIEW at_risk_students AS
SELECT
    s.id,
    s.full_name,
    s.email,
    s.classification,
    s.major_name,
    s.cumulative_gpa,
    s.has_active_holds,
    COALESCE(a.risk_score, 'Unknown') AS advising_risk_score,
    COALESCE(a.early_alerts, 0) AS early_alerts,
    COALESCE(ca.missing_assignments, 0) AS total_missing_assignments,
    COALESCE(ca.late_submissions, 0) AS total_late_submissions
FROM students s
LEFT JOIN advising a ON s.id = a.student_id
LEFT JOIN (
    SELECT student_id,
           SUM(missing_assignments) AS missing_assignments,
           SUM(late_submissions) AS late_submissions
    FROM canvas_activity
    GROUP BY student_id
) ca ON s.id = ca.student_id
WHERE s.enrollment_status = 'Enrolled'
  AND (
    s.cumulative_gpa < 2.0
    OR s.has_active_holds = TRUE
    OR a.risk_score = 'High'
    OR ca.missing_assignments > 3
  )
ORDER BY s.cumulative_gpa ASC;

CREATE MATERIALIZED VIEW aid_summary AS
SELECT
    fa.aid_year,
    fa.fund_source,
    COUNT(DISTINCT fa.student_id) AS recipients,
    SUM(fa.offer_amount) AS total_offered,
    SUM(fa.accept_amount) AS total_accepted,
    SUM(fa.disbursed_amount) AS total_disbursed,
    ROUND(AVG(fa.offer_amount), 2) AS avg_package
FROM financial_aid fa
WHERE fa.status = 'A'
GROUP BY fa.aid_year, fa.fund_source
ORDER BY fa.aid_year DESC, fa.fund_source;
