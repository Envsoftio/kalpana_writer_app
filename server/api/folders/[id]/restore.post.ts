export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, folderIdParamsSchema)
  const folder = await withDatabaseWriteTransaction(event, async (transaction) => {
    const restored = await setFolderDeletedState(event, id, false, transaction)

    await writeAuditLog(event, {
      action: 'folder.restore',
      entityType: 'folder',
      entityId: id,
    }, transaction)

    return restored
  })

  return { folder }
})
