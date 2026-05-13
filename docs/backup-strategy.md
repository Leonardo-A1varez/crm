# Backup Strategy

> B6 — RPO/RTO design para deployment self-hosted per cliente. Cliente empresa = data controller; nosotros facilita backup tooling. Re-audit semestral.

---

## 1. Objetivos RPO + RTO

| Métrica                            | Definición                              | Target pilot tier | Target mid-market tier |
| ---------------------------------- | --------------------------------------- | ----------------- | ---------------------- |
| **RPO** (Recovery Point Objective) | Cuánto data podemos perder en peor caso | **≤ 1 hour**      | **≤ 5 minutes**        |
| **RTO** (Recovery Time Objective)  | Cuánto tiempo para restaurar servicio   | **≤ 4 hours**     | **≤ 1 hour**           |

**Justificación pilot tier:**

- ~1h data loss aceptable: 30 vendedores pueden re-procesar conversaciones último hour manualmente.
- 4h downtime aceptable: usuarios industriales aftermarket tolerantes a ventanas mantenimiento.

**Mid-market+ requiere upgrades:**

- Supabase Team plan PITR 28-day retention.
- Hot standby region (multi-AZ Supabase).
- Automated failover scripts.

---

## 2. Backup layers

### Layer 1 — Supabase managed backups

| Plan              | Backup type    | Retention  | RPO            | RTO típico                   |
| ----------------- | -------------- | ---------- | -------------- | ---------------------------- |
| Free              | Daily snapshot | 7 días     | 24h            | Manual download + restore    |
| **Pro ($25/mes)** | Daily + PITR   | **7 días** | **2 min PITR** | **15-60 min manual restore** |
| Team ($599/mes)   | Daily + PITR   | 28 días    | 2 min PITR     | 15-60 min                    |

**Pilot tier obligatorio: Supabase Pro.** Free tier 24h RPO inaceptable.

**PITR (Point-in-Time Recovery):**

- Acceso desde Supabase dashboard → Database → Backups.
- Selecciona timestamp exacto (granularidad 2 min) hasta retention window.
- Crea project nuevo con snapshot a ese timestamp.
- Manual swap connection strings post-restore.

### Layer 2 — Custom S3 weekly snapshots

Mitigation contra Supabase platform issue (rare pero posible). Cliente owns backup data.

**Setup (Slice 4):**

Inngest cron weekly:

```typescript
// src/inngest/functions/backup-database.cron.ts (futuro Slice 4)
export const makeBackupDatabaseFn = (deps: BackupDeps) =>
  inngest.createFunction(
    { id: "backup-database", triggers: [{ cron: "0 5 * * 0" }] }, // sunday 5 AM
    async ({ step }) => {
      const dump = await step.run("pg-dump", () => deps.pgDump());
      const encrypted = await step.run("encrypt", () => deps.gpgEncrypt(dump));
      const url = await step.run("upload-s3", () => deps.s3Upload(encrypted));
      return { url };
    },
  );
```

**Components:**

- `pg_dump --schema=public --format=custom` produce `.dump` file.
- `gpg --encrypt --recipient backup-key@cliente.com` encrypt.
- Upload S3 bucket cliente owned: `s3://crm-backups-<cliente>/db/YYYY-MM-DD.dump.gpg`.
- Lifecycle policy S3: retention 1 año + Glacier post 30d (cost).

**Retention:**

- S3 standard: 30 días.
- S3 Glacier: 30 días - 1 año.
- Delete > 1 año.

**Decryption GPG key:**

- Cliente DPO holds private key. Sin acceso, backup useless.
- Documentar procedimiento `docs/runbooks/restore-from-backup.md` (Slice 4).

### Layer 3 — Storage objects (separately)

Supabase Storage buckets (`comprobantes_pago`, `productos`, `mensajes_media`) backupizar separadamente:

- Pilot tier: cron mensual `supabase storage export` → S3.
- Crítico: comprobantes_pago (fiscal 5 años retention legal).

---

## 3. Backup compliance considerations

Per `docs/data-retention.md` § 4:

- **Backups contienen PII** → mismo retention + erasure rules aplican.
- **Right-to-erasure backup paradox:** producción anonymize OK, backups históricos retienen PII hasta expiration. Document explícito en términos de servicio.
- **Encryption at rest:** Supabase encrypts default. S3 custom: SSE-S3 + GPG layer obligatorio.
- **Encryption in transit:** HTTPS solo. No SFTP/FTP.

---

## 4. Restore procedure

### Scenario A — Supabase PITR (RTO 15-60 min)

1. **Determine target timestamp.** Pre-incident time.
2. **Supabase dashboard** → Database → Backups → "Restore to point in time".
3. **Selecciona timestamp.** Crea project nuevo `cliente-restored-YYYY-MM-DD`.
4. **Verify data integrity:** check critical tables (`leads`, `lead_session`, `mensajes`).
5. **Swap connection strings:**
   ```bash
   vercel env add NEXT_PUBLIC_SUPABASE_URL <NEW_URL> production --force
   vercel env add SUPABASE_SERVICE_ROLE_KEY <NEW_KEY> production --force
   vercel --prod redeploy
   ```
6. **Verify webhook Meta + Inngest** funcionando (smoke test).
7. **Notify cliente** + summarize gap data (RPO actual vs target).

### Scenario B — Custom S3 backup (RTO 1-4 hours)

1. Download `.dump.gpg` from S3.
2. `gpg --decrypt backup.dump.gpg > backup.dump` (requiere private key DPO).
3. Crear Supabase project nuevo blank.
4. `pg_restore --no-owner --no-acl -d <NEW_URL> backup.dump`.
5. Verify schema + data integrity.
6. Swap connection strings + redeploy (igual A).

### Scenario C — Storage objects restore

1. Identify affected bucket.
2. `aws s3 sync s3://crm-backups-<cliente>/storage/YYYY-MM-DD/ s3://<new-supabase-bucket>/`.
3. Verify objects accesibles signed URLs.

---

## 5. Backup verification (drill cadence)

- **Monthly:** restore drill en environment dev. Verify procedure documented.
- **Quarterly:** full disaster recovery simulation. Restore + smoke test E2E.
- **Annually:** DPO compliance audit (Latam regs require demostrable backup capability).

---

## 6. Multi-region DR (mid-market+ tier)

**Pilot tier:** single region (latency Latam → us-east-1 OK ~150ms).

**Mid-market+ tier (post-pilot):**

- Supabase Team plan: 1 read replica posible (mismo region o cross-region).
- Cross-region hot standby Postgres logical replication (manual setup).
- Failover RTO ~5-15 min con automation.

**Cost mid-market hot standby:** ~$500-1500/mes extra Supabase.

---

## 7. Backup metrics + monitoring

Post Slice 4 (cuando backup cron activo):

| Métrica                       | Target                  |
| ----------------------------- | ----------------------- |
| Last successful S3 backup age | < 7 days (weekly cron)  |
| Backup file size growth       | < 20% week-over-week    |
| Restore drill success rate    | 100% per quarter        |
| Time-to-restore actual        | < 1h (vs RTO 4h target) |

**Alertas:**

- S3 cron fail → Slack `#crm-alerts` immediate.
- Backup file size unusual variance → warn.

---

## 8. Backup retention vs data retention (clarification)

Distinct concepts per `docs/data-retention.md`:

- **Data retention** = cuánto tiempo PII vive en producción DB. Per cliente policy + Latam regs.
- **Backup retention** = cuánto tiempo backups archivados existen. Sigue producción retention + grace period legal.

Si cliente solicita right-to-erasure de lead X:

1. Producción anonymize X (immediate).
2. Backups históricos retienen PII X hasta backup expiration natural.
3. NO eliminamos backups históricos para single erasure request (riesgo otros datos válidos).
4. Document explícito en términos de servicio cliente.

---

## 9. Self-hosted per cliente specifics

Cada deployment cliente tiene su propio:

- Supabase project (con su Pro/Team plan).
- S3 backup bucket (cliente AWS account ideal).
- GPG key pair (DPO controls).
- Backup cron config (per cliente env).

**Onboarding cliente nuevo (Slice 4 docs):**

- Crear Supabase project Pro+.
- Configurar S3 bucket cliente owned.
- Generate GPG key pair → cliente DPO custodia private key.
- Configurar Vercel envs.
- First backup drill obligatorio antes de go-live.

---

## 10. Disaster recovery plan summary

| Scenario                        | RTO target                                             | Plan                                        |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Single-row corruption           | < 30 min                                               | PITR Supabase + manual SQL fix              |
| Table corruption                | < 1h                                                   | PITR Supabase                               |
| Database total loss (rare)      | < 4h                                                   | PITR Supabase, sino S3 custom restore       |
| Supabase platform issue         | < 4h                                                   | S3 custom restore en Supabase project nuevo |
| Vercel platform issue           | < 30 min                                               | Vercel SLA 99.99% historical. Sin acción.   |
| Region outage (us-east-1)       | Pilot: depend Vercel SLA. Mid-market: failover region. | Mid-market hot standby                      |
| Catastrophic event multi-region | Days                                                   | Document worst-case. Insurance.             |
