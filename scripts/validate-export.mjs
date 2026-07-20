import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import {
  buildWriterTextZip,
  formatArticleText,
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

console.log(
  `Export validation passed (${folders.length} folders, ${articles.length} articles, ${archive.bytes.byteLength} ZIP bytes).`,
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
