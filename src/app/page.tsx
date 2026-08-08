import { redirect } from "next/navigation";

// La raíz no tiene contenido propio: el panel arranca en la bandeja.
// `proxy.ts` ya manda a /login a quien no tenga sesión.
export default function Home() {
  redirect("/inbox");
}
