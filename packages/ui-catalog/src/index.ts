export { parseSpec, BLOCKS, type Block, type BlockModule, type Issue, type ParseResult, type Spec } from "./core/parse.ts";
export { blockSchema, envelopeSchema } from "./core/envelope.ts";
export { sanitize, text } from "./core/sanitize.ts";
export { MAX_SPEC_BYTES, MIN_BLOCKS, MAX_BLOCKS, MAX_ALT, ID_RE, THEME_COLORS, id, color, alt } from "./core/caps.ts";
export { RESERVED } from "./core/reserved.ts";
