"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Question } from "@/lib/schools";

// Renders one config-driven application question (PDF §3/§4 field lists).
export function QuestionField({
  question,
  value,
  onChange,
  error,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const id = `q-${question.id}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {question.label}
        {question.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {question.kind === "text" && (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {question.kind === "textarea" && (
        <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      )}
      {question.kind === "select" && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(question.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {question.kind === "yesno" && (
        <RadioGroup value={value} onValueChange={onChange} className="flex gap-4 pt-1">
          {["Yes", "No"].map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={o} />
              {o}
            </label>
          ))}
        </RadioGroup>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
