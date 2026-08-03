-- CreateTable
CREATE TABLE "drafts" (
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

