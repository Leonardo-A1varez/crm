"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Logout } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/types/inbox";

export function LogoutButton({ onLogout }: { onLogout: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      disabled={isPending}
      className="text-ink-dim hover:text-ink-primary h-7 w-7 shrink-0"
      onClick={() =>
        startTransition(async () => {
          await onLogout();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <Logout size={17} />
    </Button>
  );
}
