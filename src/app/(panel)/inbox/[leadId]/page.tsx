export default async function InboxLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return <div>TODO: conversación lead {leadId} (Fase 8)</div>;
}
