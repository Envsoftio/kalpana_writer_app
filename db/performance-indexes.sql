-- Cover the Library's default folder-order query, including its null ordering.
CREATE INDEX IF NOT EXISTS idx_writer_article_folder_deleted_rank_order
  ON Article (
    folderId,
    deleted,
    rank,
    CASE WHEN orderKey IS NULL THEN 1 ELSE 0 END,
    orderKey,
    id
  );

-- Cover the commonly used recently-updated article ordering.
CREATE INDEX IF NOT EXISTS idx_writer_article_folder_deleted_updated
  ON Article (folderId, deleted, updateTime DESC, id ASC);
