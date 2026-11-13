"use client";

import { useTranslations } from "next-intl";
import type { Role } from "./types";

/** A role's name with how far it reaches: "Student (Read-Only)". An older backend sends no level. */
export function useRoleLabel(): (role: Role) => string {
  const t = useTranslations("access.level");
  return (role) => (role.access ? t(role.access, { name: role.display_name }) : role.display_name);
}
