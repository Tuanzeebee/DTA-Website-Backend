-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "member_applications" (
    "id" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "nameEn" TEXT,
    "ownership" TEXT,
    "leader" TEXT,
    "contactName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "type" TEXT NOT NULL DEFAULT 'organization',
    "domain" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT,
    "techField" TEXT,
    "consentDocUrl" TEXT,
    "legalDocUrl" TEXT,
    "message" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_applications_trackingCode_key" ON "member_applications"("trackingCode");

-- CreateIndex
CREATE INDEX "member_applications_status_createdAt_idx" ON "member_applications"("status", "createdAt");
