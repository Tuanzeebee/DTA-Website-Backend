-- CreateIndex
CREATE INDEX "news_articles_status_deletedAt_idx" ON "news_articles"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "news_articles_categoryId_status_idx" ON "news_articles"("categoryId", "status");

-- CreateIndex
CREATE INDEX "news_articles_viewsCount_idx" ON "news_articles"("viewsCount");

-- CreateIndex
CREATE INDEX "news_categories_topicId_idx" ON "news_categories"("topicId");
