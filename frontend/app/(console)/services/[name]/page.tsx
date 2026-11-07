import { ServiceDetailClient } from "./detail-client";

export default async function ServiceDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <ServiceDetailClient name={name} />;
}
