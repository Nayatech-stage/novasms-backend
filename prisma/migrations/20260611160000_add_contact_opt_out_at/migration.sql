-- RGPD (EN-1682) : suivi de la date de désabonnement pour anonymisation < 30 jours
ALTER TABLE "contacts" ADD COLUMN "optOutAt" TIMESTAMP;
ALTER TABLE "contacts" ADD COLUMN "anonymizedAt" TIMESTAMP;

-- Les contacts déjà désabonnés démarrent le délai à la date de migration
UPDATE "contacts" SET "optOutAt" = NOW() WHERE "optOut" = true;
