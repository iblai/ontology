import type { Db } from "../types";
import { buildSeed } from "./seed";

const DB_KEY = "ontology-console-db-v1";

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  if (typeof window === "undefined") {
    db = buildSeed();
    return db;
  }
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      db = JSON.parse(raw) as Db;
      return db;
    }
  } catch {}
  db = buildSeed();
  saveDb();
  return db;
}

export function saveDb(): void {
  if (typeof window === "undefined" || !db) return;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {}
}

export function mutate<T>(fn: (db: Db) => T): T {
  const d = getDb();
  const result = fn(d);
  saveDb();
  return result;
}

export function query<T>(fn: (db: Db) => T): T {
  return fn(getDb());
}

export function resetDb(): void {
  db = buildSeed();
  saveDb();
}

export function uid(prefix = ""): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function isoMinutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

export function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}