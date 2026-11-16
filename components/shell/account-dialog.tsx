"use client";

/**
 * The OS pattern (iblai/os app-sidebar AccountSheet): each sidebar footer
 * action opens one SDK organization tab in its own dialog. Nothing here is
 * ours; the SDK components talk to ibl.ai with the signed-in session.
 */

import { Admin, AdvancedTab, ApiTab, BillingTab, SecretsTab } from "@iblai/iblai-js/web-containers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import config from "@/lib/iblai/config";
import { useSession } from "@/lib/iblai/session";
import type { AccountTab } from "./shell-context";

const TITLES: Record<AccountTab, [string, string]> = {
  management: [
    "Management",
    "Users, groups, roles, policies and teams for your organization. Policies named ontology:* decide which toolsets each person or agent can call.",
  ],
  api: [
    "API",
    "Platform API tokens. Agents and MCP clients present these to the ontology gateway as Authorization: Api-Token …",
  ],
  secrets: [
    "Secrets",
    "Model providers, service credentials and environment variables stored on ibl.ai for your organization.",
  ],
  advanced: ["Advanced", "Organization-wide settings for the ibl.ai platform."],
  billing: ["Billing", "Plan, credits and invoices for your organization."],
};

const DEMO_WHAT: Record<AccountTab, string> = {
  management: "users, groups and policies",
  api: "API tokens",
  secrets: "secrets",
  advanced: "organization settings",
  billing: "billing",
};

export function DemoNotice({ what }: { what: string }) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[10px] border border-dashed border-gray-300 bg-[#fafbfc] p-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-gray-900">Sign in with ibl.ai to manage {what}</p>
        <p className="mt-1 text-[13px] text-gray-600">
          This build is running in demo mode, so it is not connected to your organization. Unset{" "}
          <code className="mono">NEXT_PUBLIC_DEMO</code> to sign in.
        </p>
      </div>
    </div>
  );
}

export function AccountDialog({
  tab,
  onClose,
  onInviteClick,
}: {
  tab: AccountTab | null;
  onClose: () => void;
  onInviteClick: () => void;
}) {
  const s = useSession();
  const open = tab !== null;
  const [title, description] = tab ? TITLES[tab] : ["", ""];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90dvh] w-[95vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-[var(--border-color)] px-5 pt-5 pb-4 text-left">
          <DialogTitle className="text-lg font-semibold text-gray-900">{title}</DialogTitle>
          <DialogDescription className="text-[13px] text-gray-600">{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {s.demo && tab && <DemoNotice what={DEMO_WHAT[tab]} />}
          {!s.demo && tab === "management" && (
            <Admin
              tenant={s.tenantKey}
              onInviteClick={onInviteClick}
              hasUserTabPermission
              hasGroupsTabPermission
              hasRolesTabPermission
              hasPoliciesTabPermission
              hasTeamsTabPermission
              hasAlertsTabPermission
              hasInviteUserPermission
              hasCreateTeamPermission
              enableRbac={false}
              rbacPermissions={{}}
              authSpaUrl={s.authUrl}
            />
          )}
          {!s.demo && tab === "api" && (
            <ApiTab
              tenantKey={s.tenantKey}
              username={s.username}
              helpUrl={config.supportEmail() ? "https://docs.ibl.ai" : undefined}
            />
          )}
          {!s.demo && tab === "secrets" && (
            <SecretsTab tenantKey={s.tenantKey} username={s.username} />
          )}
          {!s.demo && tab === "advanced" && (
            <AdvancedTab
              platformKey={s.tenantKey}
              username={s.username}
              currentSPA="agent"
              authURL={s.authUrl}
              currentPlatformBaseDomain={config.platformBaseDomain()}
            />
          )}
          {!s.demo && tab === "billing" && (
            <BillingTab
              tenant={s.tenantKey}
              username={s.username}
              mainPlatformKey={s.mainPlatformKey}
              currentUserEmail={s.email}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
