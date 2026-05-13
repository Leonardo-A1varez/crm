# Data Retention + Compliance Latam

> Compliance + retention design para CRM self-hosted Latam. Cada cliente empresa = controller de su data; nosotros como producer = procesador. Re-audit cadence: semestral.

> **Disclaimer:** este documento es technical reference. Consulta legal específica por país obligatoria pre-deploy para cada cliente. Latam laws cambian con frecuencia.

---

## 1. Marco regulatorio Latam por país

### Brasil — LGPD (Lei Geral de Proteção de Dados, Lei 13.709/2018)

- **Vigencia:** 2020.
- **Autoridad:** ANPD (Autoridade Nacional de Proteção de Dados).
- **DPO requirement:** sí, designado per controller (cliente empresa).
- **Multa:** hasta 2% revenue Brasil per infraction, cap R$50M (~$10M USD).
- **Bases legales válidas:** consentimiento + contrato + legítimo interés + obrigação legal + +6 más.
- **Direitos titular:**
  - Acesso (right of access).
  - Correção (rectification).
  - Eliminação (erasure).
  - Portabilidade (portability).
  - Revogação consentimento.
  - Anonimização / bloqueio.
- **Plazo response:** 15 días (extendible 15 días más).
- **Breach notification:** ANPD + afetados sem demora razoável (típicamente <72h).
- **Data residency:** transferência internacional permitida com adequação ANPD (Argentina/Uruguay/UE OK; USA via SCC contractuais).

### Argentina — Ley 25.326 Protección Datos Personales (1990, actualizada 2018+)

- **Vigencia:** 2000 + proyecto reforma 2023 en evaluación.
- **Autoridad:** AAIP (Agencia de Acceso a la Información Pública) / DNPDP previo.
- **DPO requirement:** no obligatorio salvo procesamiento grande / sensitive.
- **Multa:** hasta AR$100K-5M (~$100-5K USD a tipo cambio actual, ridículo bajo, en proceso reforma).
- **Bases legales:** consentimiento informado + contrato + interés legítimo + obrigação legal.
- **Direitos titular:**
  - Acceso.
  - Rectificación.
  - Supresión (right to erasure).
  - Actualización.
- **Plazo response:** 10 días corridos.
- **Breach notification:** sin obligación específica actual (reforma 2023 lo agregaría).
- **Data residency:** OK Latam + UE + países adecuados. USA via cláusulas contractuales.

### México — LFPDPPP (Ley Federal de Protección de Datos Personales en Posesión de los Particulares, 2010)

- **Vigencia:** 2010.
- **Autoridad:** INAI (Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales).
- **DPO requirement:** sí designado, no necesariamente full-time.
- **Multa:** hasta ~$10M USD (~MX$26-30M MXN) per infraction grave.
- **Bases legales:** consentimiento + relación contractual + obligación legal + +más.
- **Direitos titular (ARCO):**
  - **A**cceso.
  - **R**ectificación.
  - **C**ancelación (erasure).
  - **O**posición (objeción a procesamiento).
- **Plazo response:** 20 días hábiles.
- **Breach notification:** sin obligación específica formal, pero recomendado.
- **Aviso de privacidad obligatorio:** texto que el titular ve antes de proveer datos.
- **Data residency:** OK pero transferencia internacional requiere consentimiento o base contractual.

### Chile — Ley 19.628 (Protección de la Vida Privada, 1999) + Ley 21.719 (2024)

- **Vigencia:** 1999, modernizada por Ley 21.719 publicada 2024.
- **Autoridad:** Agencia de Protección de Datos Personales (nueva, en implementación).
- **DPO requirement:** sí, según Ley 21.719 para controllers grandes.
- **Multa:** hasta UF 20.000 (~$800K USD).
- **Direitos titular:**
  - Acceso.
  - Rectificación.
  - Cancelación.
  - Oposición.
  - Portabilidad (nueva en 21.719).
- **Plazo response:** 30 días corridos (Ley 21.719 reduce a 15 días).
- **Breach notification:** notify titular + agencia (Ley 21.719).
- **Data residency:** OK Latam + países adecuados.

### Colombia — Ley 1581 (2012, Régimen General Protección Datos Personales)

- **Vigencia:** 2012.
- **Autoridad:** SIC (Superintendencia de Industria y Comercio), Delegatura Protección Datos.
- **DPO requirement:** no obligatorio salvo procesamiento grande.
- **Multa:** hasta 2000 SMLMV (~$650K USD).
- **Direitos titular (ARCO + más):**
  - Conocer / acceder.
  - Actualizar / rectificar.
  - Solicitar prueba autorización.
  - Ser informado uso datos.
  - Presentar quejas SIC.
  - Revocar autorización.
  - Suprimir datos.
- **Plazo response:** 15 días hábiles.
- **Breach notification:** sí, SIC + afectados.
- **Registro Nacional Bases de Datos** obligatorio (RNBD).

### Perú — Ley 29.733 (Protección Datos Personales, 2011)

- **Vigencia:** 2011.
- **Autoridad:** DNPDP / ANPD del Ministerio Justicia.
- **Multa:** hasta 100 UIT (~$130K USD) en casos graves.
- **Direitos titular:** ARCO + revocación + objeción.
- **Plazo response:** 20 días hábiles.

---

## 2. Retention periods per categoría de data

### Default policy CRM (configurable por cliente)

| Categoría                                      | Retention default             | Razón legal                                     | Configuración                           |
| ---------------------------------------------- | ----------------------------- | ----------------------------------------------- | --------------------------------------- |
| **Mensajes activos** (conversaciones abiertas) | Indefinido                    | Operacional ongoing                             | NA                                      |
| **Sesiones cerradas + mensajes asociados**     | 29 días post-close            | Operacional (purge automática)                  | `closed_at < now() - 29d` (cron diario) |
| **Leads (sin actividad)**                      | 5 años                        | Comercial + posibles consultas tax/fiscal Latam | Configurable per cliente                |
| **Mensajes audit (admin_actions)**             | 5 años                        | Compliance audit trail                          | No purgable sin DPO authorization       |
| **Tool executions audit (tool_executions)**    | 90 días                       | Debug + cost analysis                           | Configurable                            |
| **Merge candidates rejected**                  | 1 año                         | Audit decisiones merge                          | Configurable                            |
| **Reactivation dispatches (audit)**            | 2 años                        | Analytics cohort + audit reactivations          | Configurable                            |
| **Cost records (LLM tracking)**                | 13 meses                      | Reporting anual                                 | Cron purge mensual                      |
| **Logs operacionales**                         | 90 días                       | Debug + incident postmortem                     | Vercel Log Drains retention             |
| **Backups DB**                                 | 30 días daily + 1 año monthly | Disaster recovery                               | Supabase Pro PITR + S3 monthly snapshot |

### Casos especiales

- **Datos sensibles** (salud / opinión política / raza / orientación sexual / biometría / financieros sensibles): retention solo si base legal explícita + consentimiento explícito + audit log. CRM aftermarket no debería capturar estos por default.
- **Comprobantes pago (imagen URL):** retention 5 años per requerimientos fiscales Latam comunes (AFIP/SAT/SUNAT).

---

## 3. Right-to-erasure design (endpoint admin)

### Requerimientos legales

Todas las leyes Latam exigen:

1. **Method para titular solicitar erasure** (formulario / email / endpoint).
2. **Response window legal** (10-30 días según país).
3. **Audit trail solicitud + ejecución**.
4. **Excepciones documentadas** (obligación legal, defensa derechos, etc).

### Implementación CRM (Slice 3+)

**Endpoint:** `POST /api/admin/leads/:leadId/erasure-request`

**Auth:** admin role only.

**Flujo:**

```
1. Validar admin authenticated.
2. Validar leadId exists.
3. Validar no hay obligación legal pendiente (e.g. compra reciente con factura fiscal en plazo legal).
4. Anonymize en lugar de DELETE: reemplazar PII por hash deterministic o tombstone.
   - leads: nombre → "ERASED", telefono → "ERASED:" + hash(originalTelefono),
     email/direccion → NULL, meta_user_ids → {}.
   - mensajes: contenido → "[ERASED]", metadata.sender_phone → NULL.
   - conversaciones: canal_thread_id mantener (FK integrity).
5. Insert admin_actions row con action='lead.erasure' + payload {leadId, requestedBy, reason, executedAt}.
6. Return 200 + audit trail confirmation.
```

**Por qué anonymize > hard DELETE:**

- Preserva integridad referencial DB.
- Permite analytics aggregate (sin PII).
- Compliance accept anonimización equivalente a erasure (LGPD Art. 12 + LFPDPPP, etc.).
- Reverse-engineering imposible sin original PII.

### Excepciones legales válidas (no eliminar)

Per legislaciones Latam, retention obligatoria pese a solicitud erasure:

- **Tax/fiscal:** comprobantes pago, facturas, registros AFIP/SAT/SUNAT. Retention 5-10 años.
- **Antimoney laundering / KYC:** si aplica (no aplica CRM básico aftermarket).
- **Defensa derechos:** procesos judiciales en curso.
- **Investigación criminal:** orden judicial.

**Implementación:** flag `legal_hold bool` per lead. Si `legal_hold=true` → erasure rejected con explanation.

---

## 4. Backup strategy + retention

### Supabase Pro PITR (Point-in-Time Recovery)

- **Available:** Pro+ plan ($25/mes per cliente self-hosted).
- **Retention:** 7 días default. Upgradeable 14-28 días.
- **RPO:** 2 minutos.
- **RTO:** ~15-60 minutos (manual restore via dashboard).

### Custom backup S3 (monthly snapshot)

- **Frequency:** monthly cron via Inngest.
- **Method:** `pg_dump` → encrypt (gpg) → upload S3 cliente bucket.
- **Retention:** 1 año.
- **Restore:** documented runbook `docs/runbooks/restore-from-backup.md` (Slice 4).

### Backup compliance considerations

- Backups contienen PII → mismo retention + erasure rules aplican.
- Erasure request afecta backups: documented que **erasure se aplica a producción + nuevos backups; backups históricos retienen PII hasta su propio expiration**.
- Cliente notificado en términos de servicio.

---

## 5. Aviso de privacidad template (per país)

Cada cliente empresa que despliega CRM debe publicar aviso de privacidad en su sitio + opt-in WhatsApp. Template generic provisto en `docs/legal/aviso-privacidad-template.md` (Slice 4).

Contenido mínimo:

1. Identidad del controller (empresa cliente).
2. Finalidades del procesamiento.
3. Datos recolectados.
4. Categorías terceros con quienes se comparte (OpenAI, Meta).
5. Periodo retention.
6. Derechos ARCO + canal ejercicio.
7. DPO contact info.
8. Autoridad reguladora del país + canal queja.

---

## 6. Sub-processors disclosure

Cliente empresa debe disclose al titular que data se procesa via sub-processors:

| Sub-processor             | Servicio                             | Data compartida                                   | Jurisdicción          |
| ------------------------- | ------------------------------------ | ------------------------------------------------- | --------------------- |
| **Meta (WhatsApp/IG/FB)** | Mensajería                           | Mensajes + metadata + meta_user_ids               | USA / IE (UE)         |
| **OpenAI**                | LLM inference                        | Mensajes (anonymized si posible) + classification | USA                   |
| **Supabase**              | DB hosting + Auth + Storage          | TODO (controller's data)                          | USA / EU según región |
| **Vercel**                | Hosting frontend + API + Edge config | Logs + request metadata                           | USA / EU según región |
| **Inngest**               | Workflow orchestration               | Event payloads (limited duration)                 | USA                   |
| **Upstash (Redis)**       | Rate limiting + cache (Slice 1+)     | IP addresses + counters                           | USA / EU              |

**Implicaciones:**

- Cliente debe disclose esta lista a sus titulares.
- DPA (Data Processing Agreements) con cada sub-processor (mayoría tienen template DPA público).
- Brasil LGPD: transferencia internacional requiere SCC o adequação ANPD.
- México LFPDPPP: requiere consentimiento explícito titular para transferencia internacional o cláusulas contractuales.

---

## 7. Audit log obligatorio

### Tabla `admin_actions` (R11) extendida

Audit log mantiene record de:

- Solicitudes ARCO recibidas.
- Erasures ejecutados (con razón + actor + timestamp).
- Modificaciones leads (rectificaciones).
- Exportaciones data (portabilidad requests).
- Cambios consent (opt-in / opt-out).

Retention `admin_actions`: **5 años mínimo** (no purgable sin DPO authorization explícita).

---

## 8. Incident response (data breach)

### Detección triggers

- Anomalía cantidad queries lectura desde IP única.
- Detección leak credenciales (key rotation triggered).
- Reportes externos (terceros notifican).
- Alertas monitoring (Sentry / observability).

### Response timeline target

| País      | Notify regulator  | Notify afectados    |
| --------- | ----------------- | ------------------- |
| Brasil    | <72h              | sem demora razoável |
| Argentina | No actual         | Reforma 2023+       |
| México    | No formal         | Recomendado         |
| Chile     | <72h (Ley 21.719) | <72h                |
| Colombia  | <15 días hábiles  | <15 días hábiles    |
| Perú      | <60 días          | <60 días            |

### Runbook → `docs/runbooks/data-breach.md` (Slice 4)

---

## 9. CRM design implications summary

| Requirement                       | CRM design choice                                                          |
| --------------------------------- | -------------------------------------------------------------------------- |
| Right-to-erasure                  | Anonymize endpoint `POST /api/admin/leads/:id/erasure-request` + audit log |
| Consent + opt-in audit            | `leads.opted_in_at` + `opt_in_source` + admin_actions records              |
| Retention period configurable     | Per-client config in `empresa_config` (Slice 3) o env vars                 |
| Backup data subject to same rules | Documented + automation expire backup data >retention                      |
| Audit trail 5 años                | `admin_actions` no-purge sin DPO + S3 archive yearly                       |
| Sub-processor disclosure          | `docs/data-retention.md` § 6 + aviso privacidad cliente                    |
| Breach notification               | `docs/runbooks/data-breach.md` + alert canal (Slice 1 7.7)                 |
| DPO contact                       | Per-client config UI (admin settings)                                      |

---

## 10. Cliente self-hosted = controller responsibility

**Importante:** en modelo white-label self-hosted, **cliente empresa es controller** (responsable legal data). Nosotros (proveedor producto) somos **processor** (procesador técnico).

**Implicaciones:**

- Cliente firma DPA con sus titulares.
- Cliente publica aviso privacidad.
- Cliente responde solicitudes ARCO.
- Cliente notifica breaches.
- Cliente decide retention extending defaults.
- Cliente owns data → cliente owns backups → cliente decide multi-region.

**Nuestro rol como processor:**

- Proveer CRM con features compliance-ready (endpoint erasure, audit log, retention config).
- Sub-processor DPA con cliente.
- Notify cliente si breach upstream (Supabase / OpenAI / Meta).
- Best practices security baseline (Slice 1+).

---

## Referencias externas

- LGPD Brasil: [https://www.gov.br/anpd/](https://www.gov.br/anpd/)
- AAIP Argentina: [https://www.argentina.gob.ar/aaip](https://www.argentina.gob.ar/aaip)
- INAI México: [https://home.inai.org.mx/](https://home.inai.org.mx/)
- Chile Ley 21.719: Diario Oficial 13 de diciembre 2024.
- SIC Colombia: [https://www.sic.gov.co/](https://www.sic.gov.co/)
- DNPDP Perú: [https://www.minjus.gob.pe/](https://www.minjus.gob.pe/)
