export interface FolderRecord {
  id: string
  name: string
  description: string | null
  createdTime: number
  updateTime: number
  rank: number
  orderKey?: string | null
  tags?: string | null
  deleted: number | boolean
  deletedTime: number
  articleCount: number
}

export interface ArticleSummary {
  id: string
  folderId: string
  categoryId: string | null
  title: string
  summary: string | null
  excerpt?: string | null
  count: number | null
  createTime: number
  updateTime: number
  rank: number
  orderKey: string | null
  deleted: number | boolean
  deletedTime: number
}

export interface ArticleRecord extends ArticleSummary {
  content: string
  extension?: string
  preview?: number
  preview1?: number
  editorId?: number
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PublicAdminUser {
  id: 'admin'
  email: string
  name: string | null
  role: 'admin'
}

export type SaveState =
  | 'saved'
  | 'unsaved'
  | 'saving'
  | 'offline'
  | 'error'
