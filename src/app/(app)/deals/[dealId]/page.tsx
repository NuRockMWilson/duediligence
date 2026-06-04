import { redirect } from "next/navigation";

export default async function DealIndex({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  redirect(`/deals/${dealId}/diligence`);
}
