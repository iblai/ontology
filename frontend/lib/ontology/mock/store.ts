import type { Db } from "../types";
import { buildSeed } from "./seed";

// ponytail: one in-memory db per server process, reseeded on restart; persistence belongs to the remote backend.
const g = globalThis as { __ontologyDb?: Db };

export function getDb(): Db {
  return (g.__ontologyDb ??= buildSeed());
}

export function mutate<T>(fn: (db: Db) => T): T {
  return fn(getDb());
}

export function query<T>(fn: (db: Db) => T): T {
  return fn(getDb());
}

export function resetDb(): void {
  g.__ontologyDb = buildSeed();
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
