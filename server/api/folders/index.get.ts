export default defineProtectedEventHandler(async (event) => {
  const { status } = validateQuery(event, folderListQuerySchema)

  return { folders: await listFolders(event, status) }
})
