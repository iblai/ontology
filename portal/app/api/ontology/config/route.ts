import { NextResponse } from "next/server";
import { readBackendConfig } from "@/lib/ontology/config-files";

// Backend configs are files on disk next to this console (see the
// admin-dashboard service in docker-compose.yml) — read them fresh per request.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(readBackendConfig());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
