-- CreateTable
CREATE TABLE "ad_placements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'banner',
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id")
);
