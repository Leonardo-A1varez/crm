# Business plan — CRM Repuestos Automotrices Latam

> Documento vivo. Spec final lockeada Pre-Slice 1 (sub-paso B0). Datos market sizing baseline 2024-2025. Re-validar quarterly.

---

## 1. Resumen

**Producto:** CRM conversacional white-label self-hosted, especializado venta de repuestos automotrices, target empresas medianas + grandes Latam.

**Modelo deployment:** 1 instalación per cliente empresa. NO multi-tenant SaaS.

**Diferenciadores frente a CRMs generalistas (HubSpot, Pipedrive, Kommo, Zendesk Sell):**

1. **Vertical aftermarket parts.** Catálogo SKU automotriz nativo + agente IA tool-aware (`buscar_repuesto(query)` con compatibilidad marca/modelo/año).
2. **Sin kanban manual.** Auto-stage IA tras cada turno. Vendedor filtra, no arrastra.
3. **Lead Twin estructurado.** Ficha mantenida por LLM extractor. Vendedor lee Twin en 3 segundos, no scrollea 30 mensajes.
4. **Motor reglas IF/THEN pre-LLM.** ~70% intents recurrentes (saludo, pregunta horario, objeción precio) respondidos sin invocar GPT-4. Reduce cost 50-70%.
5. **Reactivación predictiva.** Cron semanal segmenta leads perdidos por `motivo_perdida` + template Meta dispatch.
6. **Multi-canal nativo.** WhatsApp + Instagram + Facebook Messenger con merge cross-channel.

---

## 2. TAM Latam aftermarket parts (Total Addressable Market)

### Mercado total automotive aftermarket 2024-2025

| País      | Mercado total aftermarket | Empresas medianas-grandes activas\* | Source baseline                                                   |
| --------- | ------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| Brasil    | ~$18-22B USD              | ~400-700                            | Sindipeças + ANFIR                                                |
| México    | ~$15-18B USD              | ~300-500                            | INA (Industria Nacional de Autopartes)                            |
| Argentina | ~$4-5B USD                | ~150-250                            | AFAC (Asoc. Fábricas Argentinas Componentes) + ADEFA              |
| Chile     | ~$2-3B USD                | ~80-120                             | Cámara Comercio Automotriz Chile                                  |
| Colombia  | ~$3-4B USD                | ~100-150                            | Asopartes                                                         |
| Perú      | ~$2-3B USD                | ~60-100                             | Estimados industriales                                            |
| Ecuador   | ~$1-1.5B USD              | ~30-50                              | Estimados                                                         |
| Uruguay   | ~$0.3-0.5B USD            | ~10-20                              | Estimados                                                         |
| Paraguay  | ~$0.3-0.5B USD            | ~10-20                              | Estimados                                                         |
| Bolivia   | ~$0.3-0.5B USD            | ~10-20                              | Estimados                                                         |
| CenAm     | ~$1.5-2B USD              | ~80-120                             | Estimados (Costa Rica + Panamá + Guatemala + RD)                  |
| **TOTAL** | **~$47-60B USD**          | **~1,230-2,050 empresas target**    | Frost & Sullivan / Mordor Intelligence / Markets and Markets 2024 |

\* "Mediana-grande" = revenue >$5M USD anual, >10 empleados, >5 SKUs activos digital.

### TAM total addressable estimado

- **Empresas target: ~1,500-2,000 Latam** (filtro: revenue $5M+ + presencia digital + WhatsApp Business activo).
- **Pricing target: $5K-50K setup + $1K-5K monthly per cliente.**
- **TAM revenue: $1,500 empresas × $36K ARPU/año promedio = $54M USD ARR potencial total Latam.**

---

## 3. SAM Latam aftermarket parts (Serviceable Addressable Market)

Filtros adicionales para SAM realista:

1. **Empresas con presencia digital activa** (sitio web + WhatsApp Business + redes activas): ~40-60% del TAM = **~600-1,200 empresas**.
2. **Empresas con cultura de adopción tech** (no resistentes a SaaS B2B): ~30-50% del subset = **~200-600 empresas**.
3. **Empresas con budget software >$10K/año:** ~50-70% del subset = **~100-400 empresas**.

**SAM realista: ~300-500 empresas Latam alcanzables sin distribución física.**

**SAM revenue: ~$10-18M USD ARR.**

---

## 4. SOM (Serviceable Obtainable Market) año 3

Filtros adicionales para SOM realista (lo que captura un equipo small Latam):

| Variable                            | Valor año 3                                   |
| ----------------------------------- | --------------------------------------------- |
| Conversion rate cold lead → cliente | 2-5%                                          |
| Sales cycle                         | 3-9 meses (enterprise B2B)                    |
| Marketing channels                  | LinkedIn outbound + ferias sector + referrals |
| Churn rate                          | 10-15% anual (B2B enterprise white-label)     |
| Sales team size                     | 2-4 SDRs + 1-2 AEs                            |
| Marketing budget                    | $50K-200K/año                                 |

**SOM realista año 3: 30-80 clientes activos.**

**SOM revenue año 3: $1.1-2.9M USD ARR.**

### Camino crecimiento proyectado

| Año        | Clientes activos | ARPU promedio | ARR objetivo | Notas                                              |
| ---------- | ---------------- | ------------- | ------------ | -------------------------------------------------- |
| Y0 (pilot) | 1-3              | $24K          | $24-72K      | Pilot validation. PMF (product-market fit) test.   |
| Y1         | 5-15             | $30K          | $150-450K    | Founders sell. Manual onboarding.                  |
| Y2         | 15-40            | $36K          | $540K-1.44M  | Hire first SDR + AE. Refine ICP.                   |
| Y3         | 30-80            | $40K          | $1.2-3.2M    | Sales team. Marketing engine. Reference customers. |
| Y5         | 80-200           | $48K          | $3.8-9.6M    | Expansion product (add-ons + ERP integrations).    |

---

## 5. ICP (Ideal Customer Profile)

### Perfil empresa target

| Atributo              | Valor                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Industria             | Repuestos / autopartes / accesorios automotrices                                                  |
| Tamaño                | 10-500 empleados                                                                                  |
| Revenue anual         | $5M-500M USD                                                                                      |
| Vendedores activos    | 10-200                                                                                            |
| Volumen leads mensual | 500-50K                                                                                           |
| Canales activos       | WhatsApp Business (must) + IG (high) + FB (medium) + sitio web/MercadoLibre (variable)            |
| Geografía             | Brasil / México / Argentina / Chile / Colombia / Perú (Tier 1). Resto Latam Tier 2.               |
| Cultura tech          | CRM previo (Excel/Google Sheets/HubSpot básico) + admin con autoridad para cambio                 |
| Pain points actuales  | Vendedores pierden tiempo identificando lead, no encuentran historial, leads dispersos en canales |
| Decision maker        | Director Comercial + Director TI / CTO                                                            |

### Buyer personas

**1. Director Comercial (decisor principal)**

- Pains: dashboard ventas opaco, conversion rate desconocido, vendedores reportan mal.
- Wins con CRM: dashboard auto-stage, conversion analytics, Lead Twin per session.

**2. Director TI / CTO (técnico)**

- Pains: integración con ERP, data sovereignty Latam, security audits.
- Wins con CRM: self-hosted (cliente owns data), Supabase Postgres standard, API integration ERP.

**3. Vendedor senior (user)**

- Pains: scrollear 30 msgs cada lead, repetir respuestas comunes.
- Wins con CRM: Lead Twin 3 seg lectura, reglas IF/THEN auto-respond intents recurrentes.

---

## 6. Competitive landscape

| Competidor                   | Tipo              | Pricing           | Diferencia vs nosotros                                                                                     |
| ---------------------------- | ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **HubSpot**                  | Generalista CRM   | $20-3.6K/mes      | Bloated, multi-canal débil WA, sin agente IA seller, kanban manual.                                        |
| **Pipedrive**                | Generalista CRM   | $14-99/user/mes   | Kanban centric, sin multi-canal Meta nativo, sin agente IA.                                                |
| **Kommo (ex-amoCRM)**        | Multi-canal CRM   | $15-45/user/mes   | Multi-canal Meta sólido pero genérico, sin Lead Twin estructurado, sin catálogo conectado agente.          |
| **Salesforce Service Cloud** | Enterprise CRM    | $25-300/user/mes  | Sobre-ingeniería, sin AI seller WhatsApp nativo, costo alto Latam.                                         |
| **Zendesk Sell**             | Sales CRM         | $19-99/user/mes   | Sales-focused pero sin vertical aftermarket, sin agente IA WhatsApp avanzado.                              |
| **Take Blip**                | Conversational AI | Custom enterprise | Plataforma builder bots Latam, pero requiere build by client, no producto vertical out-of-box.             |
| **MercadoLibre Mensajes**    | Plataforma ML     | Incluido ML       | Solo dentro ecosistema ML, sin merge cross-channel, sin Lead Twin, no aplicable para empresas multi-canal. |
| **CRM custom in-house**      | Build interno     | $200K-1M+ setup   | Empresas grandes a veces buildan custom; alto cost + maintenance burden.                                   |

### Posicionamiento

**"El CRM hecho para vender repuestos en WhatsApp, no para gestionar pipeline genérico."**

Vertical aftermarket + AI seller + self-hosted Latam compliance = white space no cubierto por generalistas ni builders.

---

## 7. Pricing model

### Tier estructura

| Tier        | Vendedores | Peak msg/sec | Setup one-time | Monthly ops | Add-ons                                                                 |
| ----------- | ---------- | ------------ | -------------- | ----------- | ----------------------------------------------------------------------- |
| **Pilot**   | 30         | 50           | $5K            | $1K         | Hosting básico incluido (Supabase Pro + Vercel Hobby + Inngest Free)    |
| **Mediana** | 50-100     | 200          | $15K           | $2.5K       | Hosting Pro (Supabase Pro + Vercel Pro + Inngest Pro)                   |
| **Grande**  | 100-200    | 500          | $35K           | $4K         | Hosting Team (Supabase Team + read replicas + Vercel Pro + Inngest Pro) |
| **Top**     | 200+       | 1000+        | $50K+          | $5K+        | Custom infra + dedicated SRE + SLA enterprise + multi-region            |

### Add-ons

- **Integración ERP** (SAP/Oracle/Microsoft Dynamics/Bsale/Defontana): $5-20K setup per integración.
- **Training data custom** (catálogo + intents específicos del cliente): $2-10K.
- **Templates Meta aprobados** (HSM custom): $1-5K.
- **Custom dashboard** (analytics extra): $3-10K.
- **24/7 SRE oncall**: +$1-3K/mes.
- **Multi-region hot standby** (DR): +$2-5K/mes.

### Revenue ARPU

- ARPU promedio target: $36K-48K USD/año (setup amortizado + monthly).
- Margen bruto target: 60-70% (hosting + LLM cost + support).

---

## 8. Customer acquisition

### Canales primarios

1. **LinkedIn outbound** — SDR contacta CTO/Director Comercial sector aftermarket.
2. **Ferias sector** — AAPEX (USA con Latam attendance), AutoMec Brasil, Expo Negocios Argentina.
3. **Referrals + case studies** — empresas pilot exitosas generan word-of-mouth.
4. **Content marketing** — blog técnico WhatsApp Business + aftermarket Latam + benchmarks.
5. **Partnerships** — integradores ERP (SAP/Bsale/Defontana resellers Latam).

### CAC target

- Year 1: $5-10K CAC (founders sell, slow).
- Year 3: $3-7K CAC (sales engine, faster).
- LTV target: $150K-300K (5-year customer life).
- LTV:CAC ratio target: 15-50× (B2B enterprise SaaS norm).

---

## 9. Risk matrix

| Riesgo                                        | Probabilidad | Impacto    | Mitigación                                                                          |
| --------------------------------------------- | ------------ | ---------- | ----------------------------------------------------------------------------------- |
| Meta cambia políticas WA Business             | Alta         | Crítico    | Multi-canal IG+FB fallback. Doc `docs/meta-platform-limits.md` re-audit trimestral. |
| OpenAI pricing spike / rate limit             | Media        | Alto       | Cost cap kill switch (R6). Provider swap Vercel AI SDK trivial.                     |
| Competidor lanza vertical aftermarket         | Media        | Alto       | First-mover advantage. Reference customers + case studies.                          |
| Empresa cliente quiere multi-tenant futuro    | Baja         | Medio      | Refactor a `org_id` RLS post-Year 3 si demand consistente.                          |
| Compliance Latam cambia (LGPD/LFPDPPP)        | Media        | Alto       | Self-hosted = cliente owns data. Doc `docs/data-retention.md` re-audit semestral.   |
| Pilot empresa abandona / churn primer cliente | Alta         | Crítico Y0 | Onboarding hands-on. Customer success dedicated. SLA fijo.                          |
| Currency devaluation Latam (pricing USD)      | Alta         | Medio      | Pricing en USD pero negociable local. Hedge via setup fee upfront.                  |

---

## 10. Next steps post-launch

- **Y0 pilot:** 1-3 clientes piloto. Validar PMF + iterar UI + métricas conversion.
- **Y1 expand:** 10-15 clientes. Hire customer success + first SDR. Refine ICP.
- **Y2 scale:** 20-40 clientes. AE team. Marketing engine. Reference cases publicados.
- **Y3 mature:** 50-80 clientes. SDR team. Partnerships ERP. Expansion add-ons.
- **Y5 expansion:** Considerar multi-tenant SaaS tier (post-vertical PMF). Mantener self-hosted enterprise.

---

## Referencias externas

- Frost & Sullivan: Latin America Automotive Aftermarket 2024.
- Mordor Intelligence: Latam Automotive Aftermarket Report.
- Sindipeças (Brasil): Anuário estatístico 2024.
- INA (México): Industria Nacional de Autopartes data.
- AFAC (Argentina): Cámara Argentina de Fabricantes de Componentes.
- Markets and Markets: Global Automotive Aftermarket Forecast 2024-2029.
