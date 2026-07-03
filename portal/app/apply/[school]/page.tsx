import { ApplyWizard } from "@/components/apply/apply-wizard";

export default async function ApplyPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return <ApplyWizard slug={school} />;
}
