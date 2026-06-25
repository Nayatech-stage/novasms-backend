# Deploy NovaSMS Backend on CapRover

## CapRover app

Create a CapRover app named `novasms-backend`, connect this repository, and keep the repository root as the build context. The included `captain-definition` makes CapRover build `./Dockerfile`.

Set the app's Container HTTP Port to `3000`.

## Required environment variables

Configure these in CapRover before the first deploy:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public

REDIS_URL=redis://srv-captain--YOUR-REDIS-APP:6379
REDIS_HOST=srv-captain--YOUR-REDIS-APP
REDIS_PORT=6379

FRONTEND_URL=https://YOUR-FRONTEND-DOMAIN

JWT_ACCESS_SECRET=replace_with_a_long_random_secret
JWT_ACCESS_EXPIRATION=8h
JWT_REFRESH_SECRET=replace_with_a_different_long_random_secret
JWT_REFRESH_EXPIRATION=30d
```

The Docker container runs `prisma migrate deploy` before starting NestJS, so `DATABASE_URL` must be reachable at startup.

## Provider variables

For staging, these defaults are safe because they avoid real external sends:

```env
EMAIL_PROVIDER=mock
SMS_PROVIDER=simulation
MOBILE_MONEY_PROVIDER=simulation
VISA_PROVIDER=simulation
PUSH_PROVIDER=mock
WHATSAPP_PROVIDER=mock
```

For production, add the real provider keys from `.env.example` such as `RESEND_API_KEY`, `NOVASEND_SMS_API_KEY`, `NOVASEND_MM_API_KEY`, or `STRIPE_SECRET_KEY`.

## Campaign image storage

Use S3-compatible storage in production:

```env
CAMPAIGN_IMAGE_STORAGE_PROVIDER=s3
CAMPAIGN_IMAGE_BUCKET=novasms-campaign-images-prod
CAMPAIGN_IMAGE_PUBLIC_BASE_URL=https://YOUR-BUCKET-PUBLIC-URL
CAMPAIGN_IMAGE_S3_REGION=eu-west-3
CAMPAIGN_IMAGE_S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY
CAMPAIGN_IMAGE_S3_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
CAMPAIGN_IMAGE_S3_FORCE_PATH_STYLE=false
```
