import type { editor, IDisposable, languages, Position } from "monaco-editor";
import { DOCS, docForWord, type Doc, type DocLanguage } from "./docs.ts";

// Editor help for practice: hovers and completion details come from the docs catalogue, and error
// hovers get one plain-English line under Monaco's own message. No quick fixes and no code
// generation. Monaco is imported as types only so `node --test` can load explainMarker.

type Monaco = typeof import("monaco-editor");

/** One plain-English sentence for a Monaco marker message, or undefined when there is nothing to add. */
export function explainMarker(message: string): string | undefined {
  const name = /^Cannot find name '([^']+)'/.exec(message)?.[1];
  if (name) return `The name '${name}' is used here, but nothing with that name exists yet. Create it before this line runs, or check the spelling.`;
  if (/^Unterminated string literal/.test(message)) return "A string needs a quote at both ends. Add the missing closing quote.";
  const expected = /^'(.)' expected\./.exec(message)?.[1];
  if (expected && ")]}".includes(expected)) return "A closing bracket or parenthesis is missing. Check that every opening one has a partner.";
  if (expected === "(" || expected === "[" || expected === "{") return "An opening bracket or parenthesis is missing here.";
  if (expected) return "Something is missing here, often a typo or punctuation on this line or the one before it.";
  if (/^(Expression|Identifier|Declaration or statement|Statement) expected/.test(message)) return "The code stops where a value or expression should be. Something is missing or misplaced here.";
  if (/^Unexpected token/.test(message)) return "The code has a character in a place it does not belong. Look for a typo or a missing piece just before it.";
  return undefined;
}

/** The catalogue word a hover on `word` means. `log` only counts after `console.`, so Math.log stays plain. */
export function hoverWord(word: string, before: string): string {
  return word === "log" && /\bconsole\.\s*$/.test(before) ? "console" : word;
}

const asDocLanguage = (l: string): DocLanguage | undefined => (l === "javascript" || l === "typescript" || l === "python" ? l : undefined);
const block = (lang: string, code: string) => "```" + lang + "\n" + code + "\n```";
const COMMAND = "lq.openDoc";
/** Languages with a help editor mounted, and how many. Completion enrichment only runs while it is above 0. */
// Kept on globalThis so an HMR reload of this module does not orphan the count.
const helpActive: Map<string, number> = ((globalThis as { __lqHelpActive?: Map<string, number> }).__lqHelpActive ??= new Map());
let commandCount = 0;

function hoverMarkdown(doc: Doc, lang: string, commandId: string): string {
  return [
    `**${doc.title}** · \`${doc.src.replace(" docs", "")}\``,
    block(lang, doc.syntax),
    doc.snippet,
    `[Open in Docs](command:${commandId}?${encodeURIComponent(JSON.stringify([doc.id]))})`,
  ].join("\n\n");
}

function docMarkdown(doc: Doc, lang: string): string {
  return [`**${doc.title}**`, doc.snippet, block(lang, doc.syntax), "Example", block(lang, doc.example)].join("\n\n");
}

/**
 * Registers the hover provider, the completion enrichment and the "Open in Docs" command for one
 * editor. Dispose it when the editor goes away. `editor` limits the providers to that editor's model.
 */
export function registerEditorHelp(
  monaco: Monaco,
  language: string,
  onOpenDoc: (id: string) => void,
  ed?: editor.ICodeEditor,
): IDisposable {
  const docLang = asDocLanguage(language);
  if (!docLang) return { dispose() {} };
  const commandId = `${COMMAND}.${++commandCount}`;
  const ours = (m: editor.ITextModel) => !ed || ed.getModel() === m;

  const command = monaco.editor.registerCommand(commandId, (_accessor, id: unknown) => {
    if (typeof id === "string") onOpenDoc(id);
  });

  const hover = monaco.languages.registerHoverProvider(language, {
    provideHover(model: editor.ITextModel, pos: Position) {
      if (!ours(model)) return null;
      const contents: { value: string; isTrusted: boolean | { enabledCommands: string[] } }[] = [];
      const w = model.getWordAtPosition(pos);
      if (w) {
        const before = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: w.startColumn });
        const doc = docForWord(hoverWord(w.word, before), docLang);
        if (doc) contents.push({ value: hoverMarkdown(doc, language, commandId), isTrusted: { enabledCommands: [commandId] } });
      }
      for (const mk of monaco.editor.getModelMarkers({ resource: model.uri })) {
        const inside =
          (pos.lineNumber > mk.startLineNumber || (pos.lineNumber === mk.startLineNumber && pos.column >= mk.startColumn)) &&
          (pos.lineNumber < mk.endLineNumber || (pos.lineNumber === mk.endLineNumber && pos.column <= mk.endColumn));
        const line = inside ? explainMarker(mk.message) : undefined;
        if (line) contents.push({ value: `**In plain English.** ${line}`, isTrusted: false });
      }
      return contents.length ? { contents } : null;
    },
  });

  helpActive.set(language, (helpActive.get(language) ?? 0) + 1);

  return {
    dispose() {
      command.dispose();
      hover.dispose();
      helpActive.set(language, (helpActive.get(language) ?? 1) - 1);
    },
  };
}

type Provider = languages.CompletionItemProvider;
type EnrichedItem = languages.CompletionItem & { lqDoc?: string };

/**
 * Wraps a language service completion provider so its own suggestions carry the docs entry for words
 * in the catalogue (detail and documentation). Monaco cannot edit another provider's items, and a
 * second provider would list every word twice, so monaco.ts wraps the TS/JS provider as it registers.
 * Nothing is added to what a suggestion inserts.
 */
export function wrapCompletionProvider(provider: Provider, language: string): Provider {
  const docLang = asDocLanguage(language);
  const merge = (item: EnrichedItem): EnrichedItem => {
    if (!item.lqDoc) return item;
    const have = item.documentation;
    const old = typeof have === "string" ? have : have?.value;
    return { ...item, documentation: { value: old ? `${old}\n\n---\n\n${item.lqDoc}` : item.lqDoc } };
  };
  return {
    triggerCharacters: provider.triggerCharacters,
    async provideCompletionItems(model, pos, ctx, token) {
      const r = await provider.provideCompletionItems(model, pos, ctx, token);
      if (!r || !docLang || !helpActive.get(language)) return r;
      const before = model
        .getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column })
        .replace(/\w+$/, ""); // text before the word being typed
      const suggestions = r.suggestions.map((it): languages.CompletionItem => {
        const word = typeof it.label === "string" ? it.label : it.label.label;
        const doc = docForWord(hoverWord(word, before), docLang);
        if (!doc) return it;
        const lqDoc = docMarkdown(doc, language);
        return merge({ ...it, lqDoc, detail: it.detail ?? doc.title });
      });
      return { ...r, suggestions };
    },
    resolveCompletionItem: provider.resolveCompletionItem && (async (item, token) => {
      const resolved = await provider.resolveCompletionItem!(item, token);
      const lqDoc = (item as EnrichedItem).lqDoc;
      if (!resolved || resolved === item || !lqDoc) return resolved; // same item: already carries the docs
      const have = resolved.documentation;
      if ((typeof have === "string" ? have : have?.value)?.includes(lqDoc)) return resolved;
      return merge({ ...resolved, lqDoc });
    }),
  };
}
