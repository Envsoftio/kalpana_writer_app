import { z } from 'zod'
import { requireArticleById } from '../../utils/articles'

const paramsSchema = z.object({ id: entityIdSchema })

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)

  return { article: await requireArticleById(event, id) }
})
