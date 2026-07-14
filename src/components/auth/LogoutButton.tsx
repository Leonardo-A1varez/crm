"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/types/inbox";

export function LogoutButton({ onLogout }: { onLogout: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      className="w-full justify-start gap-3"
      onClick={() =>
        startTransition(async () => {
          await onLogout();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <LogOut className="h-4 w-4" />
      Cerrar sesión
    </Button>
  );
}
