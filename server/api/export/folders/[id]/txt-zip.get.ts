import { z } from 'zod'

const routeParamsSchema = z.object({ id: entityIdSchema })
const querySchema = z.object({
  includeDeleted: z.enum(['true', 'false', '1', '0']).default('false'),
})

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, routeParamsSchema)
  const query = validateQuery(event, querySchema)
  const includeDeleted =
    query.includeDeleted === 'true' || query.includeDeleted === '1'
  const data = await loadWriterExportData(event, {
    includeDeleted,
    folderId: id,
  })
  const archive = buildWriterTextZip(data, { includeDeleted })
  const folder = data.folders[0]

  if (!folder) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Folder not found.',
    })
  }

  const fileName = createFolderExportFileName(folder.name)

  await writeAuditLog(event, {
    action: 'export.folder_txt_zip',
    entityType: 'Folder',
    entityId: folder.id,
    metadata: {
      format: 'txt-zip',
      includeDeleted,
      fileName,
      folderDeleted: folder.deleted,
      articleCount: archive.metadata.exportInfo.articleCount,
      categoryCount: archive.metadata.exportInfo.categoryCount,
      archiveBytes: archive.bytes.byteLength,
    },
  })

  return createAttachmentResponse(archive.bytes, {
    contentType: 'application/zip',
    fileName,
  })
})
