import { ParentApplicationDetail } from "./detail-client";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ParentApplicationDetail id={id} />;
}
