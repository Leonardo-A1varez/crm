export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4">TODO: nav lateral</aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
