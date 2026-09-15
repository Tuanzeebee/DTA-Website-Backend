-- AlterTable: link User 1-1 Member (tai khoan hoi vien)
ALTER TABLE "users" ADD COLUMN "memberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_memberId_key" ON "users"("memberId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
