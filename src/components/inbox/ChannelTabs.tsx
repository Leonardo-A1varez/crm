import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Canal } from "@/types/domain";

// Links server-side en vez de tabs client: cambia el search param con
// navegación RSC, sin estado JS ni Suspense de useSearchParams.
const TABS: { value: Canal | null; label: string; href: string }[] = [
  { value: null, label: "Todos", href: "/inbox" },
  { value: "wa", label: "WhatsApp", href: "/inbox?canal=wa" },
  { value: "ig", label: "Instagram", href: "/inbox?canal=ig" },
  { value: "fb", label: "Facebook", href: "/inbox?canal=fb" },
];

export function ChannelTabs({ active }: { active: Canal | null }) {
  return (
    <nav aria-label="Filtro por canal" className="border-border flex gap-1 border-b px-2 py-1.5">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
