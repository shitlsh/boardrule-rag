import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

/** Renders Markdown to HTML for H5 (no raw HTML in source). */
export function renderMarkdownToHtml(text: string): string {
  return md.render(text || '')
}
