import { ReduxProvider } from "@/lib/ReduxProvider";
import { SdkApplyWizard } from "@/components/apply/sdk-apply-wizard";

export default async function ApplyPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return (
    <ReduxProvider>
      <SdkApplyWizard platformKey={school} />
    </ReduxProvider>
  );
}
