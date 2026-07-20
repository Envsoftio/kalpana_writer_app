import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import {
  browserExportJobFormat,
  buildWriterTextZip,
  buildWriterTextZipParts,
  createFullExportFileName,
  createWriterExportPagePathContext,
  formatArticleText,
  fullExportPartFormat,
  parseFullExportJobFormat,
  parseBrowserExportJobFormat,
  sanitizeExportName,
} from '../server/utils/export.ts'

const exportedAt = new Date('2026-07-20T12:30:00.000Z')
const folders = [
  {
    id: 'folder-1',
    name: 'Book/One',
    createdTime: Date.UTC(2021, 2, 26, 8, 0, 0),
    description: null,
    rank: 1,
    deleted: false,
    deletedTime: 0,
    updateTime: Date.UTC(2026, 6, 19, 14, 0, 0),
  },
  {
    id: 'folder-2',
    name: 'CON',
    createdTime: Date.UTC(2022, 0, 1),
    description: 'A deleted fixture folder.',
    rank: 2,
    deleted: true,
    deletedTime: Date.UTC(2025, 0, 1),
    updateTime: Date.UTC(2025, 0, 1),
  },
]
const articles = [
  createArticle({
    id: 'article-1',
    title: 'First: draft?',
    content: 'First body.\nSecond line.',
    folderId: 'folder-1',
    folderName: 'Book/One',
    rank: 1,
  }),
  createArticle({
    id: 'article-2',
    title: '',
    content: 'Untitled body.',
    folderId: 'folder-1',
    folderName: 'Book/One',
    rank: 2,
  }),
  createArticle({
    id: 'article-3',
    title: '../Deleted chapter',
    content: 'Deleted body.',
    folderId: 'folder-2',
    folderName: 'CON',
    rank: 1,
    deleted: true,
    deletedTime: Date.UTC(2025, 0, 1),
  }),
]

assert.equal(sanitizeExportName('../CON:*'), 'CON_')
assert.equal(sanitizeExportName(' . '), 'Untitled')
assert.equal(sanitizeExportName('a/b\\c'), 'a b c')
assert.equal(sanitizeExportName('A'.repeat(140)).length, 120)

const formattedArticle = formatArticleText(articles[0])
assert.equal(
  formattedArticle,
  [
    'Title: First: draft?',
    'Folder: Book/One',
    'Created: 2021-03-26 08:51:20 UTC',
    'Updated: 2026-07-19 14:47:42 UTC',
    'Deleted: false',
    'Article ID: article-1',
    '',
    'First body.',
    'Second line.',
  ].join('\n'),
)

const archive = buildWriterTextZip(
  { folders, articles, categories: [] },
  { includeDeleted: true, exportedAt },
)
const files = unzipSync(archive.bytes)
const paths = Object.keys(files)
const expectedArticlePaths = [
  'Writer Export/001 - Book One/001 - First draft.txt',
  'Writer Export/001 - Book One/002 - Untitled.txt',
  'Writer Export/002 - CON_/001 - Deleted chapter.txt',
]

assert.deepEqual(
  paths.filter((path) => path.endsWith('.txt')),
  expectedArticlePaths,
)
assert(paths.includes('Writer Export/001 - Book One/'))
assert(paths.includes('Writer Export/002 - CON_/'))
assert(paths.includes('Writer Export/_metadata/export-info.json'))
assert(paths.includes('Writer Export/_metadata/folders.json'))
assert(paths.includes('Writer Export/_metadata/articles.json'))
assert(paths.includes('Writer Export/_metadata/categories.json'))

const exportInfo = readJson(files, 'Writer Export/_metadata/export-info.json')
const articleMetadata = readJson(
  files,
  'Writer Export/_metadata/articles.json',
)

assert.deepEqual(exportInfo, {
  version: 1,
  format: 'writer-text-zip',
  exportedAt: exportedAt.toISOString(),
  includeDeleted: true,
  folderCount: 2,
  articleCount: 3,
  categoryCount: 0,
})
assert.equal(articleMetadata[0].path, expectedArticlePaths[0])
assert(!Object.hasOwn(articleMetadata[0], 'content'))
assert.equal(
  strFromU8(files[expectedArticlePaths[2]]).endsWith('Deleted body.'),
  true,
)

const parts = buildWriterTextZipParts(
  { folders, articles, categories: [] },
  {
    includeDeleted: true,
    exportedAt,
    initialSourceBytes: 1_050,
    maximumPartBytes: 2_300,
  },
)

assert.equal(parts.length, 3)
assert(parts.every((part) => part.bytes.byteLength <= 2_300))
assert.deepEqual(
  parts.flatMap((part) =>
    Object.keys(unzipSync(part.bytes)).filter((path) => path.endsWith('.txt')),
  ),
  expectedArticlePaths,
)
assert.deepEqual(parseFullExportJobFormat('txt-zip+deleted;part=2/3'), {
  includeDeleted: true,
  partIndex: 1,
  partCount: 3,
})
assert.equal(fullExportPartFormat(false, 0, 3), 'txt-zip;part=1/3')
const browserPlan = {
  parts: [
    { articleOffset: 0, articleCount: 2, estimatedBytes: 1_000 },
    { articleOffset: 2, articleCount: 1, estimatedBytes: 500 },
  ],
  articleIds: articles.map((article) => article.id),
  folderArticleCounts: [
    { folderId: 'folder-1', articleCount: 2 },
    { folderId: 'folder-2', articleCount: 1 },
  ],
}
const browserFormat = browserExportJobFormat(true, browserPlan)
assert.match(browserFormat, /^txt-zip-browser\+deleted;pages=2;snapshot=/)
assert.deepEqual(parseBrowserExportJobFormat(browserFormat), {
  includeDeleted: true,
  pageCount: 2,
  snapshot: {
    pageArticleCounts: [2, 1],
    articleIds: articles.map((article) => article.id),
    folderArticleCounts: browserPlan.folderArticleCounts,
  },
})
assert.deepEqual(parseBrowserExportJobFormat('txt-zip-browser;pages=39'), {
  includeDeleted: false,
  pageCount: 39,
  snapshot: null,
})
const pagePathContext = createWriterExportPagePathContext(
  { folders, articles: [articles[2]] },
  {
    articleOffset: 2,
    folderArticleCounts: browserPlan.folderArticleCounts,
  },
)
assert.equal(
  pagePathContext.articlePaths.get('article-3'),
  expectedArticlePaths[2],
)
assert.equal(
  createFullExportFileName(exportedAt, 2, 12),
  'Writer Export - 2026-07-20 - Part 02 of 12.zip',
)

console.log(
  `Export validation passed (${folders.length} folders, ${articles.length} articles, ${parts.length} ZIP parts).`,
)

function createArticle(overrides) {
  return {
    id: 'article',
    title: 'Article',
    content: '',
    summary: null,
    count: 0,
    extension: 'txt',
    updateTime: Date.UTC(2026, 6, 19, 14, 47, 42),
    createTime: Date.UTC(2021, 2, 26, 8, 51, 20),
    folderId: 'folder',
    folderName: 'Folder',
    categoryId: null,
    rank: 0,
    deleted: false,
    deletedTime: 0,
    orderKey: null,
    ...overrides,
  }
}

function readJson(files, path) {
  const bytes = files[path]
  assert(bytes, `Missing ${path}`)
  return JSON.parse(strFromU8(bytes))
}
