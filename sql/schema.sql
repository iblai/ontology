-- ============================================================
-- ONTOLOGY CACHE SCHEMA
-- (Component 2C: structured PostgreSQL cache)
--
-- Loaded by the ontology-db service on first start via
-- /docker-entrypoint-initdb.d/01-schema.sql. Materialized views live in
-- sql/views.sql (02-views.sql).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE TABLE students (
    id                TEXT PRIMARY KEY,        -- EMPLID from PeopleSoft
    full_name         TEXT NOT NULL,
    first_name        TEXT,
    last_name         TEXT,
    email             TEXT,
    phone             TEXT,
    date_of_birth     DATE,
    classification    TEXT,                    -- Freshman, Sophomore, Junior, Senior
    admit_term        TEXT,                    -- e.g., "FALL2023"
    expected_grad     TEXT,                    -- e.g., "SPRING2027"
    acad_career       TEXT,                    -- UGRD, GRAD, etc.
    acad_program      TEXT,                    -- e.g., "BSCS"
    major_code        TEXT,                    -- e.g., "CS"
    major_name        TEXT,                    -- e.g., "Computer Science"
    minor_code        TEXT,
    minor_name        TEXT,
    advisor_name      TEXT,
    advisor_email     TEXT,
    cumulative_gpa    NUMERIC(4, 2),
    total_credits     INTEGER,
    enrollment_status TEXT,                    -- Enrolled, Withdrawn, LOA, Graduated
    has_active_holds  BOOLEAN DEFAULT FALSE,
    dependency_status TEXT,                    -- Dependent, Independent
    residency         TEXT,                    -- In-state, Out-of-state, International
    first_gen         BOOLEAN,
    source_systems    TEXT[],                  -- e.g., {"PeopleSoft", "Canvas", "Navigate"}
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_students_classification ON students(classification);
CREATE INDEX idx_students_major ON students(major_code);
CREATE INDEX idx_students_enrollment ON students(enrollment_status);
CREATE INDEX idx_students_gpa ON students(cumulative_gpa);
CREATE INDEX idx_students_holds ON students(has_active_holds);
CREATE INDEX idx_students_name ON students USING gin(to_tsvector('english', full_name));

-- ============================================================
-- ENROLLMENT (per student per term per course)
-- ============================================================
CREATE TABLE enrollment (
    id                SERIAL PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    term_code         TEXT NOT NULL,
    term_descr        TEXT,
    course_id         TEXT NOT NULL,
    section           TEXT,
    course_title      TEXT,
    credits           INTEGER,
    instructor_name   TEXT,
    instructor_email  TEXT,
    grade             TEXT,
    grade_points      NUMERIC(3, 1),
    enrollment_status TEXT,                    -- Enrolled, Dropped, Withdrawn
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_enrollment_student ON enrollment(student_id);
CREATE INDEX idx_enrollment_term ON enrollment(term_code);
CREATE INDEX idx_enrollment_course ON enrollment(course_id);
CREATE UNIQUE INDEX idx_enrollment_unique
    ON enrollment(student_id, term_code, course_id, section);

-- ============================================================
-- TERM SUMMARY (aggregated per student per term)
-- ============================================================
CREATE TABLE term_summary (
    student_id        TEXT NOT NULL REFERENCES students(id),
    term_code         TEXT NOT NULL,
    credits_attempted INTEGER,
    credits_earned    INTEGER,
    term_gpa          NUMERIC(4, 2),
    academic_standing TEXT,
    full_time         BOOLEAN,
    PRIMARY KEY (student_id, term_code)
);

-- ============================================================
-- HOLDS / SERVICE INDICATORS
-- ============================================================
CREATE TABLE holds (
    id                SERIAL PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    hold_code         TEXT NOT NULL,
    hold_description  TEXT,
    placed_by_dept    TEXT,
    reason            TEXT,
    effective_date    DATE,
    end_date          DATE,
    is_positive       BOOLEAN DEFAULT FALSE,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_holds_student ON holds(student_id);
CREATE INDEX idx_holds_active ON holds(student_id) WHERE end_date IS NULL;

-- ============================================================
-- FINANCIAL AID
-- ============================================================
CREATE TABLE financial_aid (
    id                SERIAL PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    aid_year          TEXT NOT NULL,
    item_type         TEXT NOT NULL,
    fund_name         TEXT,
    fund_source       TEXT,                    -- F=Federal, S=State, I=Institutional
    fund_type         TEXT,
    offer_amount      NUMERIC(10, 2),
    accept_amount     NUMERIC(10, 2),
    disbursed_amount  NUMERIC(10, 2),
    remaining_balance NUMERIC(10, 2),
    status            TEXT,                    -- A=Active, C=Cancelled
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_finaid_student ON financial_aid(student_id);
CREATE INDEX idx_finaid_year ON financial_aid(aid_year);
CREATE UNIQUE INDEX idx_finaid_unique
    ON financial_aid(student_id, aid_year, item_type);

-- ============================================================
-- SAP (Satisfactory Academic Progress)
-- ============================================================
CREATE TABLE sap_status (
    student_id        TEXT NOT NULL REFERENCES students(id),
    aid_year          TEXT NOT NULL,
    overall_status    TEXT,
    gpa_status        TEXT,
    pace_status       TEXT,
    max_timeframe     TEXT,
    action_taken      TEXT,
    review_date       DATE,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (student_id, aid_year)
);

-- ============================================================
-- ISIR DATA
-- ============================================================
CREATE TABLE isir_data (
    student_id        TEXT NOT NULL REFERENCES students(id),
    aid_year          TEXT NOT NULL,
    efc               INTEGER,
    sai               INTEGER,
    dependency_status TEXT,
    pell_eligible     BOOLEAN,
    verification_status TEXT,
    agi               INTEGER,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (student_id, aid_year)
);

-- ============================================================
-- COURSES (catalog)
-- ============================================================
CREATE TABLE courses (
    id                TEXT PRIMARY KEY,
    department        TEXT,
    course_number     TEXT,
    title             TEXT,
    description       TEXT,
    credits           INTEGER,
    level             TEXT,
    prerequisites     TEXT,
    offered_terms     TEXT[],
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_courses_dept ON courses(department);

-- ============================================================
-- COURSE SECTIONS (per-term offerings)
-- ============================================================
CREATE TABLE course_sections (
    id                SERIAL PRIMARY KEY,
    course_id         TEXT NOT NULL REFERENCES courses(id),
    term_code         TEXT NOT NULL,
    section           TEXT NOT NULL,
    instructor_name   TEXT,
    instructor_email  TEXT,
    max_enrollment    INTEGER,
    current_enrollment INTEGER,
    room              TEXT,
    building          TEXT,
    schedule          TEXT,
    delivery_mode     TEXT,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sections_unique
    ON course_sections(course_id, term_code, section);

-- ============================================================
-- CANVAS ACTIVITY (LMS engagement metrics)
-- ============================================================
CREATE TABLE canvas_activity (
    student_id        TEXT NOT NULL REFERENCES students(id),
    course_id         TEXT NOT NULL,
    canvas_course_id  INTEGER,
    current_grade     TEXT,
    current_score     NUMERIC(5, 2),
    submissions_count INTEGER DEFAULT 0,
    late_submissions  INTEGER DEFAULT 0,
    missing_assignments INTEGER DEFAULT 0,
    discussion_posts  INTEGER DEFAULT 0,
    last_login_at     TIMESTAMP WITH TIME ZONE,
    total_activity_time_minutes INTEGER,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (student_id, course_id)
);

-- ============================================================
-- ADVISING / NAVIGATE DATA
-- ============================================================
CREATE TABLE advising (
    id                SERIAL PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    advisor_name      TEXT,
    last_appointment  DATE,
    next_appointment  DATE,
    risk_score        TEXT,
    early_alerts      INTEGER DEFAULT 0,
    notes             TEXT,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_advising_student ON advising(student_id);
CREATE INDEX idx_advising_risk ON advising(risk_score);

-- ============================================================
-- FACILITIES
-- ============================================================
CREATE TABLE buildings (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    address           TEXT,
    total_rooms       INTEGER,
    operational       BOOLEAN DEFAULT TRUE,
    year_built        INTEGER,
    last_renovation   INTEGER,
    square_footage    INTEGER,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE maintenance_requests (
    id                SERIAL PRIMARY KEY,
    building_id       TEXT REFERENCES buildings(id),
    description       TEXT,
    priority          TEXT,
    status            TEXT,
    submitted_by      TEXT,
    submitted_at      TIMESTAMP WITH TIME ZONE,
    completed_at      TIMESTAMP WITH TIME ZONE,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- HR / EMPLOYEES
-- ============================================================
CREATE TABLE employees (
    id                TEXT PRIMARY KEY,
    full_name         TEXT NOT NULL,
    email             TEXT,
    department        TEXT,
    title             TEXT,
    position_type     TEXT,
    hire_date         DATE,
    supervisor_id     TEXT REFERENCES employees(id),
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- IDENTITY MAP (Entra OID -> PeopleSoft EMPLID)
-- Used by the gateway to resolve ${USER_EMPLID} for self-service roles.
-- Populated during the student sync by matching on email address.
-- ============================================================
CREATE TABLE identity_map (
    entra_oid         TEXT PRIMARY KEY,        -- Entra ID object ID (from JWT "oid")
    emplid            TEXT NOT NULL,           -- PeopleSoft EMPLID
    email             TEXT,
    full_name         TEXT,
    last_synced_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- SYNC METADATA
-- ============================================================
CREATE TABLE sync_runs (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_name     TEXT NOT NULL,
    source_system     TEXT NOT NULL,
    started_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at      TIMESTAMP WITH TIME ZONE,
    status            TEXT NOT NULL,
    records_processed INTEGER DEFAULT 0,
    records_created   INTEGER DEFAULT 0,
    records_updated   INTEGER DEFAULT 0,
    error_message     TEXT,
    duration_seconds  NUMERIC(8, 2)
);

CREATE INDEX idx_sync_runs_schedule ON sync_runs(schedule_name);
CREATE INDEX idx_sync_runs_status ON sync_runs(status);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE audit_log (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id           TEXT NOT NULL,
    user_email        TEXT,
    user_role         TEXT NOT NULL,
    action            TEXT NOT NULL,
    resource          TEXT NOT NULL,
    details           JSONB,
    ip_address        INET,
    session_id        TEXT,
    entra_token_id    TEXT                     -- JWT jti claim for traceability
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_token ON audit_log(entra_token_id);
