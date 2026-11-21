/**
 * Shared rendering for transactional email templates.
 *
 * Templates return plain content; the sender adds `to`, `tags` and `replyTo`.
 * Everything interpolated here is escaped, including the user's name, so a
 * crafted display name cannot inject markup into an email.
 */

export type TemplateContent = {
  subject: string
  html: string
  text: string
}

export type LayoutInput = {
  heading: string
  preview: string
  paragraphs: string[]
  action: { label: string; url: string }
  footer: string
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character
  )
}

export function formatDuration(
  amount: number,
  unit: "hour" | "minute"
): string {
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`
}

/** Builds the shared HTML shell and its plain-text alternative. */
export function renderLayout(input: LayoutInput): {
  html: string
  text: string
} {
  const heading = escapeHtml(input.heading)
  const preview = escapeHtml(input.preview)
  const paragraphs = input.paragraphs.map(escapeHtml)
  const label = escapeHtml(input.action.label)
  const url = escapeHtml(input.action.url)
  const footer = escapeHtml(input.footer)

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f3ef;color:#1c1917;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#7c6f64;">Visit My London</p>
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">${heading}</h1>
                ${paragraphs
                  .map(
                    (paragraph) =>
                      `<p style="margin:0 0 16px;">${paragraph}</p>`
                  )
                  .join("\n                ")}
                <p style="margin:24px 0;">
                  <a href="${url}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">${label}</a>
                </p>
                <p style="margin:0 0 16px;font-size:14px;color:#57534e;">Or paste this link into your browser:<br /><a href="${url}" style="color:#1c1917;word-break:break-all;">${url}</a></p>
                <hr style="border:0;border-top:1px solid #e7e5e4;margin:24px 0;" />
                <p style="margin:0;font-size:13px;color:#78716c;">${footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    input.heading,
    "",
    ...input.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${input.action.label}: ${input.action.url}`,
    "",
    input.footer,
  ].join("\n")

  return { html, text }
}
