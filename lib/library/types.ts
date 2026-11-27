// Ready-made API definitions: what the HTTP API form is filled with when a tile is picked.
// The definitions themselves are built by scripts/library.mjs.

import type { HostApiEndpoint, HostApiOAuth } from "@/lib/host/types";

/** A ready-made system's tile in the catalog. */
export type ReadyTile = { id: string; name: string; abbr: string; color: string };

/** How a ready-made API signs in: a header to finish with the key, or an OAuth sign-in. */
export type ReadyAuth =
  | { header: string } // "Authorization: Bearer ", or "" when the API takes no key
  | {
      oauth: Pick<HostApiOAuth, "grant" | "tokenUrl" | "clientAuth" | "scope"> & {
        tokenExample?: string; // a token address of the shape, when each customer has their own
      };
    };

export type ReadyApi = ReadyTile & {
  baseUrl: string; // "" when each customer has their own address
  example: string; // an address of that shape
  hint: string; // where the key or the client comes from, one line
  auth: ReadyAuth;
  ask?: string[]; // its POSTs that only ask a question: ticked as a read is
  sources: { url: string; version: string }[]; // the vendor documents it was cut from
  endpoints: HostApiEndpoint[]; // named without the API's name, which a save puts before each
};

/** A ready-made endpoint's name as a tool's: behind the API's own name. */
export const toolName = (api: string, endpoint: string) =>
  `${api.replaceAll("-", "_")}_${endpoint}`.slice(0, 64);
