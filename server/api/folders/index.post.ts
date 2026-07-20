export default defineProtectedEventHandler(async (event) => {
  const input = await validateBody(event, createFolderBodySchema)
  const folder = await withDatabaseWriteTransaction(event, async (transaction) => {
    const created = await createFolder(event, input, transaction)

    await writeAuditLog(event, {
      action: 'folder.create',
      entityType: 'folder',
      entityId: created.id,
      metadata: { name: created.name, rank: created.rank },
    }, transaction)

    return created
  })
  setCompatibleResponseStatus(event, 201)

  return { folder }
})
