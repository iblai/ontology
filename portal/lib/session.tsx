"use client";

// Dev session — a role switcher over seeded identities.
// ponytail: replace with ibl.ai SSO via /iblai-vibe-auth when platform creds exist;
// every consumer goes through useSession() so the swap is contained here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { setActor, type Actor } from "./api";
import type { Role } from "./types";

export interface SessionUser extends Actor {
  description: string;
}

/** Seed-aligned demo identities (ids match seeded notifications/history authors). */
export const DEV_USERS: SessionUser[] = [
  {
    id: "parent_brown",
    name: "James Brown",
    role: "parent",
    email: "james.brown@example.com",
    description: "AFA family — enrolled, monthly plan, courses assigned",
  },
  {
    id: "parent_garcia",
    name: "Maria Garcia",
    role: "parent",
    email: "maria.garcia@example.com",
    description: "Grace family — enrolling, hold on account",
  },
  {
    id: "parent_lee",
    name: "Jenny Lee",
    role: "parent",
    email: "jenny.lee@example.com",
    description: "Grace family — application incomplete",
  },
  {
    id: "student_brown",
    name: "Olivia Brown",
    role: "student",
    studentId: "stu_5",
    description: "AFA student — grade 6, placement confirmed",
  },
  {
    id: "admin_afa",
    name: "A. Reyes",
    role: "afa_admin",
    schoolSlug: "afa",
    description: "American Faith Academy admissions",
  },
  {
    id: "admin_grace",
    name: "M. Osei",
    role: "network_admin",
    schoolSlug: "grace-network",
    description: "Grace Network School admissions",
  },
  {
    id: "admin_central",
    name: "C. Whitfield",
    role: "central_admin",
    description: "Ministry.com central administration",
  },
  {
    id: "admin_finance",
    name: "F. Nakamura",
    role: "finance_admin",
    description: "Tuition, fees, plans, and billing",
  },
];

const KEY = "enrollment-portal-session";

interface SessionContextValue {
  user: SessionUser | null;
  ready: boolean;
  signInAs: (userId: string) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  ready: false,
  signInAs: () => {},
  signOut: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.localStorage.getItem(KEY);
    const found = DEV_USERS.find((u) => u.id === id) ?? null;
    setUser(found);
    setActor(found);
    setReady(true);
  }, []);

  const signInAs = useCallback((userId: string) => {
    const found = DEV_USERS.find((u) => u.id === userId) ?? null;
    setUser(found);
    setActor(found);
    if (found) window.localStorage.setItem(KEY, found.id);
    else window.localStorage.removeItem(KEY);
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setActor(null);
    window.localStorage.removeItem(KEY);
  }, []);

  const value = useMemo(
    () => ({ user, ready, signInAs, signOut }),
    [user, ready, signInAs, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function homeFor(role: Role): string {
  if (role === "parent") return "/parent";
  if (role === "student") return "/student";
  return "/admin";
}

/** Redirects to /login when signed out, or to the user's home when the role doesn't match. */
export function useRequireRole(roles: Role[]): SessionUser | null {
  const { user, ready } = useSession();
  const router = useRouter();
  const allowed = user && roles.includes(user.role);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else if (!allowed) router.replace(homeFor(user.role));
  }, [ready, user, allowed, router]);

  return allowed ? user : null;
}

/** Notification lookup keys for the current user (seed id + email/studentId). */
export function notificationKeys(user: SessionUser): string[] {
  return [user.id, user.email, user.studentId].filter(Boolean) as string[];
}
