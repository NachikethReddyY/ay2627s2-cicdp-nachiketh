import type { RouterOutputs } from "../../lib/trpc";

export type Lesson = RouterOutputs["lessons"]["get"];
export type Part = NonNullable<Lesson["part"]>;
