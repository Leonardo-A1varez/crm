"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LoginInput } from "@/lib/validation/auth.schema";
import type { ActionResult } from "@/types/inbox";

export function LoginForm({ onLogin }: { onLogin: (input: LoginInput) => Promise<ActionResult> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onLogin({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/inbox");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex w-80 flex-col gap-3">
      <h1 className="text-lg font-semibold">CRM Repuestos</h1>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs">Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          disabled={isPending}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs">Contraseña</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
