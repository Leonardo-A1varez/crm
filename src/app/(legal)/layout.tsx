import { LegalNav } from "@/components/legal/LegalNav";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-root text-ink-body min-h-screen">
      <header className="border-line-layout border-b">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 pt-6 pb-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="text-ink-primary text-base font-semibold tracking-tight">
            El Genuino repuestos
          </span>
          <LegalNav />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-20 sm:px-6 sm:pt-14">{children}</main>
      <footer className="border-line-layout border-t">
        <div className="text-ink-muted mx-auto max-w-3xl px-4 py-6 text-sm sm:px-6">
          El Genuino repuestos ·{" "}
          <a
            href="https://elgenuinorepuestos.com"
            className="hover:text-ink-primary underline underline-offset-4"
          >
            elgenuinorepuestos.com
          </a>
        </div>
      </footer>
    </div>
  );
}
