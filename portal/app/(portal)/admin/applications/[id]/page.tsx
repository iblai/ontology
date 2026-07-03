import { ReviewWorkspace } from "./review-client";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkspace id={id} />;
}
