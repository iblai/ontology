"use client";

import { Card, PageHeader } from "@/components/shell/page-header";
import { RunError, useRun } from "@/components/shell/stub-page";
import { Button } from "@/components/ui/button";
import { useActions } from "@/lib/data";
import { currentTenantKey, isTenantAdmin, readCurrentTenant } from "@/lib/iblai/tenant";
import { forgetSetup, type SetupLink } from "@/lib/setup-link";

function cancel() {
  forgetSetup();
  window.location.reload();
}

/** An installer's link, opened: makes that server the ontology server of this platform. */
export function SetupServer({ link }: { link: SetupLink }) {
  const actions = useActions();
  const { busy, error, run } = useRun();
  const platform = readCurrentTenant()?.platform_name || currentTenantKey();
  const admin = isTenantAdmin();

  const setUp = () =>
    run(async () => {
      await actions.setUpServer(link.host, link.code);
      forgetSetup();
      window.location.replace("/");
    });

  return (
    <>
      <PageHeader
        title={`Set up ${link.host}`}
        description={
          <>
            This makes the server at <b>{link.host}</b> the ontology server of <b>{platform}</b>.
            It is sent your ibl.ai sign-in to check that you administer that platform. Go on only
            if you or your team installed that server.
          </>
        }
      />
      <Card className="max-w-[64ch]">
        <p className="text-[12.5px] text-gray-600">
          {admin
            ? "To use another platform, switch from your profile menu first."
            : `Only an administrator of ${platform} can set a server up.`}
        </p>
        <RunError error={error} />
        <div className="mt-3.5 flex flex-wrap gap-2">
          {admin && (
            <Button
              size="lg"
              className="ibl-button-primary"
              disabled={busy}
              onClick={() => void setUp()}
            >
              {busy ? "Setting up…" : "Set up"}
            </Button>
          )}
          <Button size="lg" variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </>
  );
}
