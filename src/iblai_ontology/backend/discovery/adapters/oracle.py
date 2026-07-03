"""Oracle-backed adapters: PeopleSoft and Ellucian Banner."""

from __future__ import annotations

from .base import BaseAdapter, register


@register("peoplesoft")
class PeopleSoftAdapter(BaseAdapter):
    """Pre-built adapter for PeopleSoft on Oracle."""

    SYSTEM_NAME = "peoplesoft"
    DB_TYPE = "oracle"

    TABLE_PATTERNS = {
        "PS_STDNT_": "students",
        "PS_ACAD_": "academics",
        "PS_CLASS_": "courses",
        "PS_CRSE_": "courses",
        "PS_ENRL_": "enrollment",
        "PS_FIN_AID_": "financial_aid",
        "PS_SF_": "student_financials",
        "PS_ADM_": "admissions",
        "PS_PERSONAL_": "demographics",
        "PS_ADDRESSES": "demographics",
        "PS_NAMES": "demographics",
        "PS_EMAIL_ADDRESSES": "demographics",
        "PS_JOB": "hr",
        "PS_EMPLOYMENT": "hr",
        "PS_POSITION_": "hr",
        "PS_DEPT_": "departments",
        "PS_FACILITY_": "facilities",
    }

    KNOWN_TABLES = {
        "PS_STDNT_CAR_TERM": {
            "description": (
                "Student career/term records — one row per student per academic term. "
                "Contains GPA, credits attempted/earned, enrollment status."
            ),
            "sync_cadence": "1h",
            "suggested_tools": [
                {
                    "name": "get-student-enrollment",
                    "description": "Get a student's enrollment by term",
                    "sql": "SELECT * FROM PS_STDNT_CAR_TERM WHERE EMPLID = :1 ORDER BY STRM DESC",
                    "parameters": [
                        {
                            "name": "student_id",
                            "type": "string",
                            "description": "EMPLID",
                        }
                    ],
                    "toolset": "enrollment-tools",
                }
            ],
        },
        "PS_STDNT_ENRL": {
            "description": (
                "Student class enrollment — one row per student per class. Tracks "
                "enrollment status, grade, units."
            ),
            "sync_cadence": "1h",
        },
        "PS_CLASS_TBL": {
            "description": (
                "Class schedule — one row per class section per term. Meeting patterns, "
                "instructors, room assignments."
            ),
            "sync_cadence": "6h",
        },
        "PS_PERSONAL_DATA": {
            "description": "Person biographical data — name, DOB, gender, ethnicity. One row per person.",
            "sync_cadence": "24h",
        },
        "PS_ADDRESSES": {
            "description": "Person addresses — home, mailing, campus. Multiple rows per person.",
            "sync_cadence": "24h",
        },
        "PS_NAMES": {
            "description": "Person names — primary, preferred, former. Multiple rows per person.",
            "sync_cadence": "24h",
        },
        "PS_FIN_AID_AWARD": {
            "description": (
                "Financial aid awards — one row per student per aid year per award. "
                "Award type, status, amounts."
            ),
            "sync_cadence": "1h",
        },
        "PS_ADM_APPL_DATA": {
            "description": "Admissions applications — one row per application. Admit type, status, decisions.",
            "sync_cadence": "6h",
        },
    }


@register("banner")
class BannerAdapter(BaseAdapter):
    """Pre-built adapter for Ellucian Banner on Oracle."""

    SYSTEM_NAME = "banner"
    DB_TYPE = "oracle"

    TABLE_PATTERNS = {
        "SPRIDEN": "demographics",
        "SPBPERS": "demographics",
        "SGBSTDN": "students",
        "SFRSTCR": "enrollment",
        "STVTERM": "courses",
        "SSBSECT": "courses",
        "RPRAWRD": "financial_aid",
        "RORSTAT": "financial_aid",
        "SARADAP": "admissions",
    }

    KNOWN_TABLES = {
        "SGBSTDN": {
            "description": "Student base record — program, level, college, degree, status. One row per effective term.",
            "sync_cadence": "1h",
        },
        "SPRIDEN": {
            "description": "Person identification — Banner ID, name. Current + historical rows per person.",
            "sync_cadence": "24h",
        },
        "SFRSTCR": {
            "description": "Student course registration — one row per student per CRN per term.",
            "sync_cadence": "1h",
        },
        "RPRAWRD": {
            "description": "Financial aid award — one row per fund per aid year per student.",
            "sync_cadence": "1h",
        },
    }


@register("snowflake")
class SnowflakeAdapter(BaseAdapter):
    """Snowflake data warehouse (read-only SQL). Schema discovered live."""

    SYSTEM_NAME = "snowflake"
    DB_TYPE = "snowflake"
