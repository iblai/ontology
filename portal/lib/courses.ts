// ponytail: static demo course catalog — real catalog comes from the LMS.

export interface CatalogCourse {
  courseId: string;
  courseName: string;
}

const CORE = ["Math", "Language Arts", "Science", "History", "Bible"];
const ELECTIVES = ["Art", "Music", "Physical Education", "Latin"];

export function catalogForGrade(gradeLevel: string): CatalogCourse[] {
  const g = gradeLevel || "K";
  const core = CORE.map((c) => ({
    courseId: `${c.toLowerCase().replace(/\s+/g, "")}${g}`,
    courseName: `${c} ${g}`,
  }));
  const electives = ELECTIVES.map((c) => ({
    courseId: `${c.toLowerCase().replace(/\s+/g, "")}${g}`,
    courseName: c,
  }));
  return [...core, ...electives];
}
