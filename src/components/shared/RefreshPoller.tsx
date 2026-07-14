"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refetch RSC vía router.refresh() cada intervalMs. Puente hasta Supabase
 * Realtime (Slice 3). Tab oculta no refetchea; al volver visible se
 * re-sincroniza inmediato.
 */
export function RefreshPoller({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
