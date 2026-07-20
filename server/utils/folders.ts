import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { z } from 'zod'

const MAX_FOLDER_NAME_LENGTH = 500
const MAX_FOLDER_DESCRIPTION_LENGTH = 20_000
const MAX_FOLDER_TAGS_LENGTH = 20_000

const nullableText = (maximum: number) =>
  z.union([z.string().max(maximum), z.null()]).transform((value) => {
    if (value === null) {
      return null
    }

    const normalized = value.trim()
    return normalized || null
  })

export const folderIdParamsSchema = z.object({
  id: entityIdSchema,
})

export const folderListQuerySchema = z.object({
  status: z.enum(['active', 'deleted', 'all']).default('active'),
})

export const createFolderBodySchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FOLDER_NAME_LENGTH),
    description: nullableText(MAX_FOLDER_DESCRIPTION_LENGTH).optional(),
    tags: nullableText(MAX_FOLDER_TAGS_LENGTH).optional(),
    rank: z.number().int().min(0).optional(),
  })
  .strict()

export const updateFolderBodySchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FOLDER_NAME_LENGTH).optional(),
    description: nullableText(MAX_FOLDER_DESCRIPTION_LENGTH).optional(),
    tags: nullableText(MAX_FOLDER_TAGS_LENGTH).optional(),
    rank: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one folder field is required.',
  })

export interface WriterFolderRecord {
  id: string
  name: string
  createdTime: number
  description: string | null
  rank: number
  deleted: number
  deletedTime: number
  selectedArticleId: string | null
  selectedArticleId1: string | null
  selectedOutlineId: string | null
  extension: string | null
  updateTime: number
  rankUpdateTime: number
  autoChapter: number
  autoChapterUpdateTime: number
  autoChapterResetForCategory: number
  autoChapterResetForCategoryUpdateTime: number
  autoChapterReplaceBadPrefix: number
  autoChapterReplaceBadPrefixUpdateTime: number
  tags: string | null
  tagsUpdateTime: number
  rankMode: string | null
  rankModeUpdateTime: number
  articleCount: number
}

const FOLDER_SELECT = `
  SELECT
    folder.id AS id,
    folder.name AS name,
    folder.createdTime AS createdTime,
    folder.description AS description,
    folder.rank AS rank,
    folder.deleted AS deleted,
    folder.deletedTime AS deletedTime,
    folder.selectedArticleId AS selectedArticleId,
    folder.selectedArticleId1 AS selectedArticleId1,
    folder.selectedOutlineId AS selectedOutlineId,
    folder.extension AS extension,
    folder.updateTime AS updateTime,
    folder.rankUpdateTime AS rankUpdateTime,
    folder.autoChapter AS autoChapter,
    folder.autoChapterUpdateTime AS autoChapterUpdateTime,
    folder.autoChapterResetForCategory AS autoChapterResetForCategory,
    folder.autoChapterResetForCategoryUpdateTime AS autoChapterResetForCategoryUpdateTime,
    folder.autoChapterReplaceBadPrefix AS autoChapterReplaceBadPrefix,
    folder.autoChapterReplaceBadPrefixUpdateTime AS autoChapterReplaceBadPrefixUpdateTime,
    folder.tags AS tags,
    folder.tagsUpdateTime AS tagsUpdateTime,
    folder.rankMode AS rankMode,
    folder.rankModeUpdateTime AS rankModeUpdateTime,
    (
      SELECT COUNT(*)
      FROM Article AS article
      WHERE article.folderId = folder.id AND article.deleted = 0
    ) AS articleCount
  FROM Folder AS folder
`

export async function listFolders(
  event: H3Event,
  status: 'active' | 'deleted' | 'all',
): Promise<WriterFolderRecord[]> {
  const filter =
    status === 'all'
      ? ''
      : status === 'active'
        ? 'WHERE folder.deleted = 0'
        : 'WHERE folder.deleted = 1'
  const result = await getDatabaseClient(event).execute(`
    ${FOLDER_SELECT}
    ${filter}
    ORDER BY folder.rank ASC, folder.name COLLATE NOCASE ASC, folder.id ASC
  `)

  return result.rows.map(mapFolderRow)
}

export async function getFolderById(
  event: H3Event,
  id: string,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<WriterFolderRecord | null> {
  const result = await database.execute({
    sql: `${FOLDER_SELECT} WHERE folder.id = ? LIMIT 1`,
    args: [id],
  })
  const row = result.rows[0]

  return row ? mapFolderRow(row) : null
}

export async function requireFolderById(
  event: H3Event,
  id: string,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<WriterFolderRecord> {
  const folder = await getFolderById(event, id, database)

  if (!folder) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Folder not found.',
    })
  }

  return folder
}

export async function createFolder(
  event: H3Event,
  input: z.output<typeof createFolderBodySchema>,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<WriterFolderRecord> {
  const now = Date.now()
  const id = randomBytes(12).toString('hex')
  let rank = input.rank

  if (rank === undefined) {
    const rankResult = await database.execute(
      'SELECT COALESCE(MAX(rank), -1) + 1 AS nextRank FROM Folder WHERE deleted = 0',
    )
    rank = Number(rankResult.rows[0]?.nextRank ?? 0)
  }

  await database.execute({
    sql: `
      INSERT INTO Folder (
        id,
        name,
        createdTime,
        description,
        rank,
        deleted,
        deletedTime,
        selectedArticleId,
        selectedArticleId1,
        selectedOutlineId,
        extension,
        updateTime,
        rankUpdateTime,
        autoChapter,
        autoChapterUpdateTime,
        autoChapterResetForCategory,
        autoChapterResetForCategoryUpdateTime,
        autoChapterReplaceBadPrefix,
        autoChapterReplaceBadPrefixUpdateTime,
        tags,
        tagsUpdateTime,
        rankMode,
        rankModeUpdateTime
      )
      VALUES (?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, 'txt', ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, NULL, 0)
    `,
    args: [
      id,
      input.name,
      now,
      input.description ?? null,
      rank,
      now,
      input.rank === undefined ? 0 : now,
      input.tags ?? null,
      input.tags === undefined ? 0 : now,
    ],
  })

  return requireFolderById(event, id, database)
}

export async function updateFolder(
  event: H3Event,
  id: string,
  input: z.output<typeof updateFolderBodySchema>,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<WriterFolderRecord> {
  await requireFolderById(event, id, database)
  const now = Date.now()
  const assignments = ['updateTime = ?']
  const args: Array<string | number | null> = [now]

  if (input.name !== undefined) {
    assignments.push('name = ?')
    args.push(input.name)
  }

  if (input.description !== undefined) {
    assignments.push('description = ?')
    args.push(input.description)
  }

  if (input.tags !== undefined) {
    assignments.push('tags = ?', 'tagsUpdateTime = ?')
    args.push(input.tags, now)
  }

  if (input.rank !== undefined) {
    assignments.push('rank = ?', 'rankUpdateTime = ?')
    args.push(input.rank, now)
  }

  args.push(id)
  await database.execute({
    sql: `UPDATE Folder SET ${assignments.join(', ')} WHERE id = ?`,
    args,
  })

  return requireFolderById(event, id, database)
}

export async function setFolderDeletedState(
  event: H3Event,
  id: string,
  deleted: boolean,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<WriterFolderRecord> {
  const existing = await requireFolderById(event, id, database)
  const expectedCurrentState = deleted ? 0 : 1

  if (existing.deleted !== expectedCurrentState) {
    throw createError({
      statusCode: 409,
      statusMessage: deleted
        ? 'Folder is already deleted.'
        : 'Folder is not deleted.',
    })
  }

  const now = Date.now()
  const result = await database.execute({
    sql: `
      UPDATE Folder
      SET deleted = ?, deletedTime = ?, updateTime = ?
      WHERE id = ? AND deleted = ?
    `,
    args: [deleted ? 1 : 0, deleted ? now : 0, now, id, expectedCurrentState],
  })

  if (result.rowsAffected !== 1) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Folder state changed before the request completed.',
    })
  }

  return requireFolderById(event, id, database)
}

function mapFolderRow(row: Record<string, unknown>): WriterFolderRecord {
  return {
    id: requiredString(row.id, 'id'),
    name: requiredString(row.name, 'name'),
    createdTime: requiredNumber(row.createdTime, 'createdTime'),
    description: nullableString(row.description, 'description'),
    rank: requiredNumber(row.rank, 'rank'),
    deleted: requiredNumber(row.deleted, 'deleted'),
    deletedTime: requiredNumber(row.deletedTime, 'deletedTime'),
    selectedArticleId: nullableString(
      row.selectedArticleId,
      'selectedArticleId',
    ),
    selectedArticleId1: nullableString(
      row.selectedArticleId1,
      'selectedArticleId1',
    ),
    selectedOutlineId: nullableString(
      row.selectedOutlineId,
      'selectedOutlineId',
    ),
    extension: nullableString(row.extension, 'extension'),
    updateTime: requiredNumber(row.updateTime, 'updateTime'),
    rankUpdateTime: requiredNumber(row.rankUpdateTime, 'rankUpdateTime'),
    autoChapter: requiredNumber(row.autoChapter, 'autoChapter'),
    autoChapterUpdateTime: requiredNumber(
      row.autoChapterUpdateTime,
      'autoChapterUpdateTime',
    ),
    autoChapterResetForCategory: requiredNumber(
      row.autoChapterResetForCategory,
      'autoChapterResetForCategory',
    ),
    autoChapterResetForCategoryUpdateTime: requiredNumber(
      row.autoChapterResetForCategoryUpdateTime,
      'autoChapterResetForCategoryUpdateTime',
    ),
    autoChapterReplaceBadPrefix: requiredNumber(
      row.autoChapterReplaceBadPrefix,
      'autoChapterReplaceBadPrefix',
    ),
    autoChapterReplaceBadPrefixUpdateTime: requiredNumber(
      row.autoChapterReplaceBadPrefixUpdateTime,
      'autoChapterReplaceBadPrefixUpdateTime',
    ),
    tags: nullableString(row.tags, 'tags'),
    tagsUpdateTime: requiredNumber(row.tagsUpdateTime, 'tagsUpdateTime'),
    rankMode: nullableString(row.rankMode, 'rankMode'),
    rankModeUpdateTime: requiredNumber(
      row.rankModeUpdateTime,
      'rankModeUpdateTime',
    ),
    articleCount: requiredNumber(row.articleCount, 'articleCount'),
  }
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    invalidFolderColumn(column)
  }

  return value
}

function nullableString(value: unknown, column: string): string | null {
  if (value === null) {
    return null
  }

  return requiredString(value, column)
}

function requiredNumber(value: unknown, column: string): number {
  const number = Number(value)

  if (!Number.isSafeInteger(number)) {
    invalidFolderColumn(column)
  }

  return number
}

function invalidFolderColumn(column: string): never {
  throw createError({
    statusCode: 500,
    statusMessage: `Folder column ${column} has an unexpected value.`,
  })
}
