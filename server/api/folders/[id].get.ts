export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, folderIdParamsSchema)

  return { folder: await requireFolderById(event, id) }
})
