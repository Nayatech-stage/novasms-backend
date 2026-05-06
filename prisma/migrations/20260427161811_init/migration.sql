-- CreateTable
CREATE TABLE "comptes" (
    "id" TEXT NOT NULL,
    "nomEntreprise" VARCHAR(255) NOT NULL,
    "emailAdmin" VARCHAR(255) NOT NULL,
    "motDePasse" VARCHAR(255) NOT NULL,
    "pays" CHAR(3) NOT NULL,
    "soldeCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "seuilAlerte" DECIMAL(12,2),
    "dateCreation" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statutRGPD" VARCHAR(50) NOT NULL DEFAULT 'actif',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "confirmationToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),

    CONSTRAINT "comptes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "mdpHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "actif2FA" BOOLEAN NOT NULL DEFAULT false,
    "derniereConnexion" TIMESTAMP,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "email" VARCHAR(255),
    "telephone" VARCHAR(20),
    "prenom" VARCHAR(100),
    "nom" VARCHAR(100),
    "tags" JSONB,
    "dateAjout" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optOut" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "nom" VARCHAR(255),
    "type" VARCHAR(20),
    "criteres" JSONB,
    "dernierCalcul" TIMESTAMP,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campagnes" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "typeCanal" VARCHAR(20) NOT NULL,
    "sujet" VARCHAR(255),
    "contenu" TEXT,
    "statut" VARCHAR(20) NOT NULL,
    "datePlanification" TIMESTAMP,
    "coutEstime" DECIMAL(12,2),

    CONSTRAINT "campagnes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envois" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "statut" VARCHAR(20) NOT NULL,
    "dateEnvoi" TIMESTAMP,
    "dateOuverture" TIMESTAMP,
    "dateClic" TIMESTAMP,

    CONSTRAINT "envois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatisations" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "nom" VARCHAR(255),
    "declencheur" VARCHAR(100),
    "delaiSecondes" INTEGER,
    "workflow" JSONB,
    "statut" VARCHAR(20) NOT NULL,

    CONSTRAINT "automatisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "methode" VARCHAR(20),
    "reference" VARCHAR(255),
    "statut" VARCHAR(20) NOT NULL,
    "date" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "nom" VARCHAR(255),
    "typeCanal" VARCHAR(20),
    "contenuHTML" TEXT,
    "estPreset" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "action" VARCHAR(255),
    "date" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expiry" TIMESTAMP NOT NULL,
    "statut" VARCHAR(20) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rapports_import" (
    "id" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "fichier" VARCHAR(255),
    "total" INTEGER,
    "succes" INTEGER,
    "doublons" INTEGER,
    "erreurs" INTEGER,
    "date" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rapports_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(50),
    "compteId" TEXT NOT NULL,
    "statut" VARCHAR(20) NOT NULL,
    "dateCreation" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFin" TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT,
    "contactId" TEXT,
    "action" VARCHAR(20),
    "timestamp" TIMESTAMP,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmap_engagement" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "heure" INTEGER NOT NULL,
    "nbOuvertures" INTEGER NOT NULL DEFAULT 0,
    "nbClics" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "heatmap_engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmap_clicks" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "zone" VARCHAR(255),
    "nbClics" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "heatmap_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentements" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dateConsentement" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(255),

    CONSTRAINT "consentements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factures" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "cheminS3" VARCHAR(255),
    "dateGeneration" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comptes_emailAdmin_key" ON "comptes"("emailAdmin");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_confirmationToken_key" ON "comptes"("confirmationToken");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_email_key" ON "utilisateurs"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "factures_transactionId_key" ON "factures"("transactionId");

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campagnes" ADD CONSTRAINT "campagnes_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois" ADD CONSTRAINT "envois_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois" ADD CONSTRAINT "envois_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatisations" ADD CONSTRAINT "automatisations_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rapports_import" ADD CONSTRAINT "rapports_import_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmap_engagement" ADD CONSTRAINT "heatmap_engagement_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmap_clicks" ADD CONSTRAINT "heatmap_clicks_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentements" ADD CONSTRAINT "consentements_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
