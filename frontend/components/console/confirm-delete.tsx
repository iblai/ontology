"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";

/** The quiet trash button with its confirm dialog: an icon in a table row, icon + `label` on a page. */
export function ConfirmDelete({
  name,
  label,
  title,
  body,
  action,
  onConfirm,
}: {
  name: string;
  label?: string;
  /** Dialog copy; the common delete wording unless the page has its own. */
  title?: string;
  body?: string;
  action?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const tc = useTranslations("common");
  const heading = title ?? tc("deleteTitle", { name });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={label ? "outline" : "ghost"}
          size="sm"
          className={
            label ? "hover:text-red-600" : "text-muted-foreground h-8 px-2 hover:text-red-600"
          }
          aria-label={label ? undefined : heading}
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="size-3.5" />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{heading}</AlertDialogTitle>
          <AlertDialogDescription>{body ?? tc("deleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm()}
            className={buttonVariants({ variant: "destructive" })}
          >
            {action ?? tc("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
