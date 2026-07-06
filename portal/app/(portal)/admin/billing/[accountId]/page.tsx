import { LedgerClient } from "./ledger-client";

export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <LedgerClient accountId={accountId} />;
}
