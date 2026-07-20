export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, folderIdParamsSchema)
  const input = await validateBody(event, updateFolderBodySchema)
  const folder = await withDatabaseWriteTransaction(event, async (transaction) => {
    const updated = await updateFolder(event, id, input, transaction)

    await writeAuditLog(event, {
      action: 'folder.update',
      entityType: 'folder',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    }, transaction)

    return updated
  })

  return { folder }
})
