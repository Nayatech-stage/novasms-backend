/*
  Warnings:

  - Added the required column `nomBoutique` to the `comptes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "comptes" ADD COLUMN     "nomBoutique" VARCHAR(255) NOT NULL;
