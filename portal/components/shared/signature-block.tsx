"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/format";

// Typed electronic signature: name + typed signature (rendered italic serif) + auto date.
export function SignatureBlock({
  label,
  name,
  signature,
  onNameChange,
  onSignatureChange,
  error,
}: {
  label: string;
  name: string;
  signature: string;
  onNameChange: (v: string) => void;
  onSignatureChange: (v: string) => void;
  error?: string;
}) {
  const t = useTranslations("signature");
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-medium">{label}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("fullName")}</Label>
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("signature")}</Label>
          <Input
            value={signature}
            onChange={(e) => onSignatureChange(e.target.value)}
            placeholder={t("signaturePlaceholder")}
            className="font-serif italic"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("dateSigned")}: {fmtDate(new Date().toISOString())}
      </p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
