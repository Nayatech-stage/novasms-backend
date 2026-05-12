-- Create primary user rows for existing accounts if missing
INSERT INTO "users" ("id", "accountId", email, "passwordHash", role, "twoFactorEnabled")
SELECT
  lower(
    substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 9, 4) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 13, 4) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 17, 4) || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 21, 12)
  ),
  a.id,
  a."adminEmail",
  a."passwordHash",
  COALESCE(a.role, 'admin'),
  false
FROM "accounts" a
WHERE NOT EXISTS (
  SELECT 1
  FROM "users" u
  WHERE u.email = a."adminEmail"
);

-- Move account-level role to user-level role
UPDATE "users" u
SET role = COALESCE(a.role, 'admin')
FROM "accounts" a
WHERE u.email = a."adminEmail";

ALTER TABLE "accounts" DROP COLUMN IF EXISTS role;
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "twoFactorEnabled";