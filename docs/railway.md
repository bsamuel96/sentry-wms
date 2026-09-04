# Railway deployment without Docker

Use one Railway project with managed PostgreSQL, managed Redis and one or more
services connected to this repository. The API service uses the repository root
so that both `api/` and `db/schema.sql` are available during deployment.

## API service

- Root Directory: `/`
- Builder: Railpack
- Build Command: leave empty
- Pre-deploy Command: `python api/bootstrap_railway.py`
- Start Command: `gunicorn --chdir api -w 4 --timeout 180 -b 0.0.0.0:$PORT 'app:create_app()'`
- Healthcheck Path: `/api/health`

Required database/cache references:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
CELERY_BROKER_URL=${{Redis.REDIS_URL}}
CELERY_RESULT_BACKEND=${{Redis.REDIS_URL}}
SENTRY_INBOUND_MAPPINGS_DIR=/app/db/mappings
```

Railpack checks out the repository under `/app`, so inbound mapping documents
committed under `db/mappings/` are available at `/app/db/mappings`. The default
`/db/mappings` path is intended for the Docker Compose volume mount and must not
be used for this Railway setup.

Set `ADMIN_PASSWORD` to a unique value of at least 12 characters. The first
pre-deploy initializes the schema and a minimal admin account. Later deploys
take an advisory lock, detect the existing schema and skip initialization.

The remaining application secrets and production settings follow `.env.example`.
Never import the placeholder values from that file into Railway.
