// The one error every host module throws, and the one way a route turns it into an answer.

export class HostError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

// A HostError keeps its status and words; anything else is a 500 that names itself.
export function fail(error: unknown): Response {
  if (error instanceof HostError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, 500);
}
