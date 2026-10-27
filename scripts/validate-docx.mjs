import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { buildStoryDocx, storyDocxFileName } from '../utils/story-docx.ts'

const episodes = [
  {
    id: 'one',
    title: 'First & <opening>',
    content: 'First line\r\n\r\n  Indented\ttext & more 😀',
  },
  { id: 'two', title: 'Second', content: 'Last line' },
]
const archive = unzipSync(buildStoryDocx('A & <story>', episodes))
const document = strFromU8(archive['word/document.xml'])
const styles = strFromU8(archive['word/styles.xml'])

assert(archive['[Content_Types].xml'])
assert(archive['_rels/.rels'])
assert(archive['word/_rels/document.xml.rels'])
assert(archive['docProps/core.xml'])
assert(styles.includes('w:styleId="Heading1"'))
assert(document.includes('A &amp; &lt;story&gt;'))
assert(document.includes('First &amp; &lt;opening&gt;'))
assert(document.includes('  Indented'))
assert(document.includes('<w:tab/>'))
assert(document.includes('text &amp; more 😀'))
assert.equal((document.match(/w:type="page"/g) ?? []).length, 1)
assert(document.indexOf('First &amp;') < document.indexOf('Second'))
assert.equal(storyDocxFileName('../CON:<draft>'), 'CON draft.docx')

const selected = strFromU8(
  unzipSync(buildStoryDocx('Story', [episodes[1]]))['word/document.xml'],
)
assert(selected.includes('Second'))
assert(!selected.includes('First &amp;'))

console.log('DOCX validation passed (all and selected episodes).')
