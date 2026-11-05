import { z } from "zod";
import type { BlockModule } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";

const MAX_MD = 2000;

type Props = { md: string };

// Tags and comments only; a bare "<" or "a < b" is fine because the renderer shows everything as text anyway.
const HTML = /<\/?[a-z!]/i;

export const textBlock: BlockModule<Props> = {
  type: "text",
  schema: z.strictObject({ md: text(MAX_MD) }),
  check: (b) => (HTML.test(b.props.md) ? [{ path: "props.md", message: "HTML is not allowed" }] : []),
  describe: (b) => b.props.md,
  prompt: `Use \`text\` for a short explanation, definition or caption that no other block covers.
\`md\` is plain text in paragraphs (blank line between them); only **bold** and *italic* are styled.
No HTML, no headings, lists or images. Links are shown as plain text, not clickable.
Example: {"type":"text","id":"intro","props":{"md":"A **fraction** shows part of a whole.\\n\\nThe bottom number says how many equal parts."}}`,
  budget: 6,
};
