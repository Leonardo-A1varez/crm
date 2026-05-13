export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div>TODO: detalle lead {id} (Fase 8)</div>;
}
