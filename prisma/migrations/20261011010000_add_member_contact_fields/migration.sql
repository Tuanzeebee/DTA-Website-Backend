-- AlterTable: thẻ Danh bạ đủ thông tin (góp ý 10/2026): email lãnh đạo,
-- cán bộ đầu mối (tên, SĐT, email) và địa chỉ.
ALTER TABLE "members" ADD COLUMN "leaderEmail" TEXT;
ALTER TABLE "members" ADD COLUMN "contactName" TEXT;
ALTER TABLE "members" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "members" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "members" ADD COLUMN "address" TEXT;

ALTER TABLE "member_applications" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "member_applications" ADD COLUMN "leaderEmail" TEXT;
ALTER TABLE "member_applications" ADD COLUMN "address" TEXT;
