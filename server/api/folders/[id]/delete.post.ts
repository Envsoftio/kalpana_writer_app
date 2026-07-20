export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, folderIdParamsSchema)
  const folder = await withDatabaseWriteTransaction(event, async (transaction) => {
    const deleted = await setFolderDeletedState(event, id, true, transaction)

    await writeAuditLog(event, {
      action: 'folder.delete',
      entityType: 'folder',
      entityId: id,
    }, transaction)

    return deleted
  })

  return { folder }
})
