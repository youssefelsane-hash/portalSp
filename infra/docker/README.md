# infra/docker

بيئة التطوير المحلية الكاملة — PostgreSQL 16 + PostGIS، Redis، MinIO (S3-compatible).

## التشغيل

```bash
cp .env.example .env   # عدّل لو حابب
docker compose up -d
```

بعد ما الـ db يبقى healthy، طبّق الـ migrations من `../migrations` (راجع README بتاعه).

## الخدمات

| الخدمة | البورت | الاستخدام |
|---|---|---|
| `db` | 5432 | PostgreSQL 16 + PostGIS |
| `redis` | 6379 | جلسات، rate limiting، طوابير BullMQ |
| `minio` | 9000 (API) / 9001 (Console) | تخزين الصور والمستندات محلياً بديل S3 |

مرجع كامل: `../../docs/01-master-plan.md` §2.2, §3.1
