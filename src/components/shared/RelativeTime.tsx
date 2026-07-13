"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

function fmt(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: es });
}

/**
 * "hace 3 minutos" auto-refresh cada 30s. Label computado en render; el
 * interval solo fuerza re-render. `suppressHydrationWarning` porque server y
 * client pueden caer en buckets de tiempo distintos.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {fmt(iso)}
    </time>
  );
}
