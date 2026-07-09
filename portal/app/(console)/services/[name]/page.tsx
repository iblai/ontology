import { notFound } from "next/navigation";
import { apiClient } from "@/lib/ontology/api-client";
import { ServiceDetailClient } from "./detail-client";

export default async function ServiceDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const service = await apiClient.services.get(name);
  if (!service) notFound();
  return <ServiceDetailClient service={service} />;
}