-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "collection_name" TEXT NOT NULL,
    "corpus_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "brand_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "network" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_sources_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "brand_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand_id" TEXT NOT NULL,
    "source_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_documents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "brand_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "brand_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "verdict" TEXT,
    "tone_score" REAL,
    "accuracy_score" REAL,
    "structure_score" REAL,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "issues" TEXT NOT NULL DEFAULT '[]',
    "cost_usd" REAL,
    "notion_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brand_id" TEXT,
    CONSTRAINT "drafts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_drafts" ("accuracy_score", "audience", "channel", "content", "cost_usd", "created_at", "id", "issues", "iterations", "notion_url", "structure_score", "tone", "tone_score", "topic", "verdict", "word_count") SELECT "accuracy_score", "audience", "channel", "content", "cost_usd", "created_at", "id", "issues", "iterations", "notion_url", "structure_score", "tone", "tone_score", "topic", "verdict", "word_count" FROM "drafts";
DROP TABLE "drafts";
ALTER TABLE "new_drafts" RENAME TO "drafts";
CREATE INDEX "drafts_brand_id_idx" ON "drafts"("brand_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_collection_name_key" ON "brands"("collection_name");

-- CreateIndex
CREATE INDEX "brand_sources_brand_id_idx" ON "brand_sources"("brand_id");

-- CreateIndex
CREATE INDEX "brand_documents_brand_id_kind_idx" ON "brand_documents"("brand_id", "kind");

