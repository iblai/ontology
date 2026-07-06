import type { Db } from "../types";
import { buildSeed } from "./seed";

const KEY = "enrollment-portal-db-v1";

// ponytail: localStorage-backed mock DB. One global cache; fine for a single-user
// demo. Swap this whole module for real REST calls when a backend exists.
let cache: Db | null = null;

function fresh(): Db {
  return buildSeed();
}

function read(): Db {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = fresh();
    return cache;
  }
  const raw = window.localStorage.getItem(KEY);
  if (raw) {
    try {
      cache = JSON.parse(raw) as Db;
      return cache;
    } catch {
      // fall through to reseed on corrupt data
    }
  }
  cache = fresh();
  write(cache);
  return cache;
}

function write(db: Db): void {
  cache = db;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(db));
  }
}

/** Read-modify-write the DB. Returns whatever the mutator returns. */
export function mutate<T>(fn: (db: Db) => T): T {
  const db = read();
  const result = fn(db);
  write(db);
  return result;
}

/** Read-only snapshot (deep-copied so callers can't mutate the cache). */
export function query<T>(fn: (db: Db) => T): T {
  return clone(fn(read()));
}

export function resetDb(): void {
  const db = fresh();
  write(db);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---- id / time helpers (fine in app runtime; only Workflow scripts forbid these) ----
export function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function now(): string {
  return new Date().toISOString();
}
