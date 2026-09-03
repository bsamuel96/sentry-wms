# Deploy the Sentry WMS admin on Vercel

This deployment publishes the React admin UI and keeps browser requests same-origin by
proxying `/api/*` through a Vercel Function to the separately hosted Sentry WMS API.

## Vercel project settings

1. Import `bsamuel96/sentry-wms` into Vercel.
2. Set **Root Directory** to `admin`.
3. Keep **Framework Preset** as Vite.
4. Use `npm run build` as the build command and `dist` as the output directory. These
   values are also committed in `vercel.json`.
5. Add `SENTRY_API_URL` in **Settings → Environment Variables** for Production and
   Preview. Its value is the public API origin, for example
   `https://sentry-api.example.com`, without `/api` at the end.
6. Deploy.

`SENTRY_API_URL` is read only by the server-side proxy and is not included in the Vite
browser bundle. Do not add credentials, integration tokens, database URLs or Redis URLs
to the Vercel admin project.

## Required API configuration

The API must be reachable over HTTPS. Configure its proxy/CORS origin settings for the
Vercel production domain, then verify:

- `/api/health` responds through the Vercel domain;
- login sets both `sentry_auth` and `sentry_csrf` cookies on the Vercel domain;
- refreshing a protected page remains authenticated;
- a read-only admin page can load data without CORS errors.

The PostgreSQL database, Redis, Celery worker, snapshot keeper, webhook dispatcher and
connector publisher are long-running Sentry WMS backend components. They are not part of
this Vercel admin deployment and must run on the container host with the API.
