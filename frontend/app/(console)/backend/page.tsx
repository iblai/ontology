import { notFound } from "next/navigation";
import { MULTI_PLATFORM } from "@/lib/ontology/server/backend";
import { BackendClient } from "./backend-client";

/** The hosted console alone: a console with one backend of its own has no address to change. */
export default function BackendPage() {
  if (!MULTI_PLATFORM) notFound();
  return <BackendClient />;
}
