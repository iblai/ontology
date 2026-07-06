"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

// ponytail: records file name + size only — no real storage (PLAN §12).
export function FileUploadStub({
  onUpload,
  label,
}: {
  onUpload: (meta: { name: string; sizeBytes: number }) => void;
  label?: string;
}) {
  const t = useTranslations("common");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload({ name: f.name, sizeBytes: f.size });
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Upload className="size-3.5" />
        {label ?? t("upload")}
      </Button>
    </>
  );
}
