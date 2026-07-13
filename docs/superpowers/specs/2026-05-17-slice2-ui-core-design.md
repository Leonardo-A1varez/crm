# Slice 2 UI Core — Design Spec

> **Fecha:** 2026-05-17
> **Estado:** propuesta (pendiente aprobación usuario)
> **Sub-fase padre:** Slice 2 — UI + Realtime + Server Actions (next-session.md Opción A)
> **Sub-paso inmediato siguiente:** 8.1 (layout + SideNav + read-only inbox list)

---

## 1. Scope

### Qué hace

CRM single-org UI core operacional para vendedores: bandeja chats activos (estilo WhatsApp Web), conversación por lead con thread mensajes + Lead Twin sidebar, acciones críticas (enviar mensaje, pausar/reanudar IA, cerrar sesión). Refresh mensajes nuevos vía polling 5s `router.refresh()` hasta Slice 3 (auth+RLS) habilite Supabase Realtime.

### Qué NO hace

- Realtime via Supabase (diferido Slice 3).
- Vistas leads/productos/intents-reglas/tags/métricas/ajustes funcionales (stubs hasta sub-pasos posteriores Slice 2).
- Auth + login + RLS (Slice 3).
- Edición lead (read-only en 8.x; CRUD diferido).
- Branding/theme white-label (diferido Slice 2 final o Slice 4 launch).
- Foto-to-SKU, RAG, fine-tuning (v2).
- Reportes BI, dashboards.
- Drag-drop kanban (auto-stage IA, sin board manual).
- Tests UI con RTL + axe-core (decisión pendiente Slice 2 final — diferible).

### Tecnologías

| Capa          | Decisión                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16 App Router (RSC + Server Actions)                                                                                                                                                                  |
| UI primitives | shadcn/ui ya instalado: badge, button, card, dialog, dropdown-menu, input, scroll-area, select, separator, sonner, table, tabs, textarea. **A agregar conforme se necesite:** avatar, tooltip, popover, sheet |
| Estilos       | Tailwind v4 + prettier-plugin-tailwindcss                                                                                                                                                                     |
| Validación    | Zod (línea 1 en cada Server Action, regla §0.9.3)                                                                                                                                                             |
| Data fetch    | RSC fetch directo via repos/services (service-role pre-auth Slice 3)                                                                                                                                          |
| Mutations     | Server Actions `'use server'` colocadas `_actions/` por vista                                                                                                                                                 |
| Realtime      | **Diferido Slice 3.** Mientras: `<ConversationPoller>` client `router.refresh()` cada 5s                                                                                                                      |
| Estado client | `useTransition` para Server Actions + `useOptimistic` opcional. Sin TanStack/SWR                                                                                                                              |
| Iconos        | lucide-react (ya dep si shadcn lo trae)                                                                                                                                                                       |
| Toasts        | sonner (ya instalado)                                                                                                                                                                                         |

---

## 2. Arquitectura

### Data flow read (RSC)

```
[Browser] GET /inbox/[leadId]
   │
   ▼
[RSC InboxLeadPage] (async)
   │
   ▼
[InboxService.getConversation(leadId)] (facade)
   │
   ├─▶ [leadRepo.findById]
   ├─▶ [leadSessionRepo.findActiveByLead]
   ├─▶ [conversationRepo.findByLeadAndCanal]
   └─▶ [messagesRepo.listBySession(sessionId, limit=200)]
   │
   ▼
[Supabase service-role DbClient]
   │
   ▼
[render server-side]
   │
   ├─▶ <ConversationHeader />        (server, lead + canales + stage + acciones)
   ├─▶ <ChatThread />                (server, messages → MessageBubble[])
   ├─▶ <TwinPanel />                 (server, lead_session.extras)
   ├─▶ <MessageInput leadId sessionId />   (client, form + Server Action)
   ├─▶ <HandoffToggle ... />         (client)
   ├─▶ <CloseSessionButton ... />    (client)
   └─▶ <ConversationPoller intervalMs={5000} />   (client)
```

### Data flow write (Server Action)

```
[<MessageInput>] (client) — user submit
   │
   ▼
[Server Action 'use server' send-message.action.ts]
   1. SendMessageSchema.parse(formData)        ← Zod línea 1 (regla §0.9.3)
   2. await inboxService.sendOutbound(input)
   3. revalidatePath(`/inbox/${input.leadId}`)
   │
   ▼
[InboxService.sendOutbound] (Default impl)
   ├─▶ messagesRepo.insert (con idempotency_key)
   ├─▶ metaApi.sendText (canal correcto)
   ├─▶ eventOutbox.publish('message.outbound.sent')   ← B2 outbox at-least-once
   └─▶ logger.info (PII redacted, regla §0.9.1)
   │
   ▼ throws DomainError jerarquía (regla §0.10.3)
   │
   ▼ catch en action → toast error vía sonner
```

### Service facade rationale

**Decisión:** `InboxService` facade orquestador, no llamar repos/services granulares directo desde RSC/Actions.

**Razones:**

- Concentra Zod parse + emit + revalidate + error mapping en 1 lugar testeable.
- Mantiene capas (rule arch): Action → Service → Repo. Action es ultra-thin.
- Tests unit con InMemory repos + spy meta-api (consistente con pattern existente).
- Cuando Slice 3 trae auth, swap service-role → authed client = 1 línea en factory.

### ESLint zones impacto

Sin cambios. Zone `app` ya permite import `server-services + components + lib + types`. Server Actions `_actions/*.ts` viven bajo `app/(panel)/**` → zone `app`. Service nuevo `src/server/services/inbox/` → zone `server-services` (importa repos).

---

## 3. Estructura archivos

### Nuevos / modificados código

```
src/
├── app/(panel)/
│   ├── layout.tsx                                  [MOD] nav lateral real
│   ├── error.tsx                                   [NEW] error boundary panel
│   ├── inbox/
│   │   ├── page.tsx                                [MOD] RSC fetch listActiveLeads → <InboxList>
│   │   ├── loading.tsx                             [NEW] Suspense skeleton lista
│   │   ├── [leadId]/
│   │   │   ├── page.tsx                            [MOD] RSC fetch getConversation → render
│   │   │   └── loading.tsx                         [NEW] Suspense skeleton conversación
│   │   └── _actions/
│   │       ├── send-message.action.ts              [NEW]
│   │       ├── toggle-handoff.action.ts            [NEW]
│   │       └── close-session.action.ts             [NEW]
│
├── components/
│   ├── inbox/
│   │   ├── InboxList.tsx                           [MOD] server
│   │   ├── InboxListItem.tsx                       [NEW] server
│   │   ├── ChatList.tsx                            [DEL] reemplazado por InboxList
│   │   ├── ChatThread.tsx                          [MOD] server
│   │   ├── MessageBubble.tsx                       [NEW] server
│   │   ├── MessageInput.tsx                        [MOD] client
│   │   ├── HandoffToggle.tsx                       [NEW] client
│   │   ├── CloseSessionButton.tsx                  [NEW] client
│   │   ├── ChannelIcons.tsx                        [MOD] server
│   │   ├── ChannelTabs.tsx                         [NEW] client
│   │   ├── ConversationHeader.tsx                  [NEW] server
│   │   └── ConversationPoller.tsx                  [NEW] client
│   ├── lead-twin/
│   │   ├── TwinPanel.tsx                           [MOD] server
│   │   ├── TwinField.tsx                           [KEEP]
│   │   ├── StageBadge.tsx                          [MOD] color por enum
│   │   └── TwinEmptyState.tsx                      [NEW]
│   ├── shared/
│   │   ├── SideNav.tsx                             [NEW] client
│   │   ├── EmptyState.tsx                          [NEW] server
│   │   └── RelativeTime.tsx                        [NEW] client
│   └── ui/                                         [ADD vía shadcn CLI cuando necesite]
│
├── lib/
│   └── validation/
│       └── inbox.schema.ts                         [NEW] SendMessage/ToggleHandoff/CloseSession schemas
│
└── server/
    └── services/
        └── inbox/
            ├── inbox.service.ts                    [NEW] interface InboxService
            └── default-inbox.service.ts            [NEW] impl
```

### Tests

```
tests/unit/server/services/inbox/
  └── default-inbox.service.test.ts                 [NEW]
```

### Docs

- `docs/next-session.md` actualizado tras cada sub-paso completado.
- Este spec: `docs/superpowers/specs/2026-05-17-slice2-ui-core-design.md`.

---

## 4. Componentes (contratos)

### Server Components (RSC)

| Componente           | Props                                            | Responsabilidad                                                                                                                    |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PanelLayout`        | `{ children }`                                   | Sidebar fijo + main scroll                                                                                                         |
| `InboxList`          | `{ items: InboxListItem[] }`                     | `<ScrollArea>` + map items                                                                                                         |
| `InboxListItem`      | `{ lead, lastMessage, currentStage, canales[] }` | `<Link>` a `/inbox/[leadId]` + preview                                                                                             |
| `ConversationHeader` | `{ lead, session, canales }`                     | Nombre + ChannelIcons + StageBadge + HandoffToggle + CloseSessionButton                                                            |
| `ChatThread`         | `{ messages }`                                   | Div `flex-col-reverse` + array invertido = bottom-anchored sin JS (impl 8.2; reemplaza ScrollArea+auto-scroll del diseño original) |
| `MessageBubble`      | `{ message }`                                    | In/out alignment + body + timestamp + delivery status                                                                              |
| `ChannelIcons`       | `{ activos[], activoActual? }`                   | Íconos SVG (WA verde, IG morado, FB azul). Grande = activo, chicos = vinculados                                                    |
| `TwinPanel`          | `{ leadSession }`                                | Card con TwinField[] dinámico según `extras` jsonb                                                                                 |
| `StageBadge`         | `{ stage: CurrentStageEnum }`                    | Badge color-coded                                                                                                                  |
| `EmptyState`         | `{ title, description, icon? }`                  | Reusable empty UI                                                                                                                  |

### Client Components

| Componente           | Props                               | Responsabilidad                                                                      |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `SideNav`            | —                                   | `usePathname()` + 7 nav items + highlight activo                                     |
| `MessageInput`       | `{ leadId, sessionId, canal }`      | `<textarea>` + send btn + `useTransition` + Server Action send-message + toast error |
| `HandoffToggle`      | `{ leadId, sessionId, isHandoff }`  | Button + Server Action toggle-handoff + toast                                        |
| `CloseSessionButton` | `{ leadId, sessionId }`             | `<Dialog>` confirm + select resultado + Server Action close-session                  |
| `ChannelTabs`        | `{ active, available[], onChange }` | Filter chats por canal (URL search param `?canal=wa`)                                |
| `ConversationPoller` | `{ intervalMs }`                    | `useEffect` + `setInterval(router.refresh, intervalMs)` + cleanup                    |
| `RelativeTime`       | `{ iso }`                           | "hace 3m" → refresh cada 30s                                                         |

---

## 5. Server Actions

### `send-message.action.ts`

Schema:

```
SendMessageSchema = {
  leadId: uuid,
  sessionId: uuid,
  body: string.min(1).max(4096),
  canal: enum('wa', 'ig', 'fb'),
}
```

Flow: `parse(formData)` → `inboxService.sendOutbound(input)` → `revalidatePath`.

Errors esperados:

- `ValidationError` (Zod parse fail) → 400 client toast "input inválido"
- `NotFoundError` (lead/session) → 404 toast
- `BusinessRuleError` (session closed) → toast "sesión cerrada"
- `InfraError` (Meta API down) → toast "Meta no responde, reintentando" + outbox at-least-once

### `toggle-handoff.action.ts`

Schema:

```
ToggleHandoffSchema = {
  leadId: uuid,
  sessionId: uuid,
  action: enum('pause', 'resume'),
}
```

Side effect: emit `session.handoff.toggled` event.

### `close-session.action.ts`

Schema:

```
CloseSessionSchema = {
  leadId: uuid,
  sessionId: uuid,
  resultado: enum('exito', 'perdido'),
  motivo: string.max(500).optional(),
}
```

Side effect: emit `session.closed` event → cron purge la elegirá +29d.

---

## 6. Error handling

- Repos throw → mapped a `DomainError` jerarquía via `mapPostgrestError` ya existente.
- Services validan business rules → throw `BusinessRuleError`.
- Server Actions catch → log + toast con `sonner` (mensaje user-friendly, no dump stack).
- RSC errors → `error.tsx` boundary nuevo en `(panel)/`.
- Logs via `logger.error()`, JAMÁS `console.error` (ESLint regla §0.9.5). PII redacted (regla §0.9.1).

---

## 7. Sub-pasos atómicos (cadencia regla §5)

Cada sub-paso = 1 commit, validar antes de avanzar. Pausa para confirmación entre cada uno.

| Sub-paso | Scope                                                                                                                             | Validación                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **8.1**  | Layout shell + SideNav + InboxService.listActiveLeads + inbox/page RSC + InboxList + InboxListItem + loading.tsx + EmptyState     | `npm run dev` → `/inbox` muestra leads activos reales Supabase. Empty state si 0 leads. Tests service. |
| **8.2**  | ConversationHeader + ChatThread + MessageBubble + RelativeTime + ChannelIcons + inbox/[leadId]/page RSC + getConversation service | `/inbox/[leadId]` muestra thread completo read-only.                                                   |
| **8.3**  | TwinPanel + TwinField + StageBadge + TwinEmptyState                                                                               | Sidebar derecha renderiza twin del session activa.                                                     |
| **8.4**  | MessageInput client + send-message.action + InboxService.sendOutbound                                                             | Enviar mensaje real outbound Meta. Aparece en thread tras revalidate.                                  |
| **8.5**  | HandoffToggle + CloseSessionButton + toggle-handoff.action + close-session.action                                                 | Pausar/reanudar IA. Cerrar sesión cambia estado + redirect `/inbox`.                                   |
| **8.6**  | ConversationPoller client                                                                                                         | Inbound mensaje vía webhook Meta sandbox → aparece en thread ≤5s sin F5 manual.                        |
| **8.7**  | ChannelTabs filter + InboxList filter por search param                                                                            | `/inbox?canal=wa` filtra solo WA.                                                                      |
| **8.8**  | InboxService tests full (Default impl + edge cases)                                                                               | `npm test` 100% inbox service.                                                                         |

Sub-pasos 9-12 (post-8.x, Slice 2 cont.): leads vista, productos vista, intents-reglas vista, tags vista, métricas vista, ajustes vista. Diferidos.

---

## 8. Decisiones tomadas / pendientes

### Tomadas

- Approach A (colocated `_actions/`).
- Polling 5s vs Realtime ahora.
- Service facade `InboxService` (no llamar repos directo desde RSC).
- shadcn add on-demand (no bulk install upfront).
- Auth bypass dev OK (Slice 3 agrega middleware).
- Empty state inbox: "Esperando primer mensaje. Verificá webhook Meta configurado."

### Pendientes (diferibles, no bloquean 8.1)

1. Branding/theme white-label CSS variables — Slice 2 final o Slice 4.
2. Tests UI con React Testing Library + axe-core — Slice 2 final o Slice 4.
3. Routing leads CRUD edit — Slice 2 sub-pasos 9-12.
4. Slack-like keyboard shortcuts (`j`/`k` navegar chats) — v2.
5. Mobile responsive — pilot desktop-only, mobile diferido.

---

## 9. Riesgos + mitigaciones

| Riesgo                                                                | Mitigación                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Polling 5s saturará servidor con 30 vendedores → 6 req/s sólo polling | Aceptable (Vercel function = barato). Si dolor: cambiar a Realtime Slice 3.                      |
| Sin auth → URL `/inbox/[leadId]` accesible públicamente en producción | Bloqueante Slice 3. Pre-launch Slice 4 NO deployment público sin middleware redirect.            |
| Service-role en RSC → XSS rasgo expondría todos los leads             | Mitigación: outputs siempre escapados React; sin sinks de raw HTML; audit Slice 3.               |
| `revalidatePath` no actualiza si user en otra tab                     | ConversationPoller cubre. Si tab inactivo → `visibilitychange` pausa polling (optional).         |
| MessageInput sin debounce → user spam send                            | Disabled durante `isPending` de `useTransition`. Server Action idempotent vía `idempotency_key`. |

---

## 10. Out of scope (explícito)

- Multi-tenancy.
- BSPs (Twilio, 360dialog).
- WhatsApp no oficial (Baileys).
- Foto-to-SKU.
- Voice notes.
- File attachments (solo comprobante_pago_url ya en DB; UI upload diferido Slice 2 final).
- Templates pre-aprobados WhatsApp (diferido Slice 4 launch).
- Bulk actions (mover múltiples leads, asignar tags batch).
- Export CSV/Excel.
- Time tracking / SLA metrics.

---

## 11. Verificación end-to-end sub-paso 8.1

Pasos:

1. `npm run dev` (puerto 3001) + `npm run inngest:dev`.
2. Browser → `http://localhost:3001/inbox`.
3. Esperado:
   - SideNav lateral con 7 items + Inbox activo highlight.
   - Si DB tiene leads con sesión activa: lista renderiza nombre + último mensaje + stage + canales.
   - Si DB vacía: EmptyState "Esperando primer mensaje. Verificá webhook Meta configurado."
4. `npm test -- inbox.service` verde.
5. `npm run typecheck` 0 errors.
6. `npm run lint` 0 errors.

Si OK → commit `feat(ui): Slice 2 8.1 layout + SideNav + inbox read-only list` → push.

---

**FIN SPEC.**
