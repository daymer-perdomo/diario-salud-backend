-- CreateEnum
CREATE TYPE "BlogDraftStatus" AS ENUM ('PENDIENTE_REDACCION', 'EN_REDACCION', 'REDACTADO');

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "globalId" TEXT NOT NULL,
    "sourceContentId" TEXT,
    "sourceFile" TEXT,
    "sourceRow" INTEGER,
    "hub" TEXT NOT NULL,
    "subHub" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cluster" TEXT,
    "tagPrincipal" TEXT,
    "tagsSecondary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seoPriority" TEXT,
    "regulatoryLevel" TEXT,
    "intention" TEXT,
    "productPolicy" TEXT,
    "validationRequired" TEXT,
    "aiGenerationRule" TEXT,
    "notes" TEXT,
    "draftStatus" "BlogDraftStatus" NOT NULL DEFAULT 'PENDIENTE_REDACCION',
    "reviewStatus" TEXT NOT NULL DEFAULT 'À relire',
    "medicalValidationStatus" TEXT NOT NULL DEFAULT 'À valider si requis',
    "publicationStatus" TEXT NOT NULL DEFAULT 'Non publié',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_sections" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_post_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_faqs" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "faqBlockId" TEXT,
    "questionNumber" INTEGER,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "sourceQuestion" TEXT,
    "sourceReferences" TEXT,
    "regulatoryLevel" TEXT,
    "productPolicy" TEXT,
    "validationRequired" TEXT,
    "notes" TEXT,
    "sourceFile" TEXT,
    "sourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_tags" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "role" TEXT,
    "linkedHubs" TEXT,
    "linkedSubHubs" TEXT,
    "contentCount" INTEGER,
    "examples" TEXT,
    "usageRule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_globalId_key" ON "blog_posts"("globalId");

-- CreateIndex
CREATE INDEX "blog_posts_hub_idx" ON "blog_posts"("hub");

-- CreateIndex
CREATE INDEX "blog_posts_draftStatus_idx" ON "blog_posts"("draftStatus");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_sections_postId_order_key" ON "blog_post_sections"("postId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "blog_tags_tag_key" ON "blog_tags"("tag");

-- AddForeignKey
ALTER TABLE "blog_post_sections" ADD CONSTRAINT "blog_post_sections_postId_fkey" FOREIGN KEY ("postId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_faqs" ADD CONSTRAINT "blog_faqs_postId_fkey" FOREIGN KEY ("postId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

