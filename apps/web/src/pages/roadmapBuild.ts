import { assign, fromPromise, setup } from "xstate";
import { trpc, type RouterOutputs } from "../lib/trpc";

type Roadmap = RouterOutputs["paths"]["get"];
type Context = { slug: string; data?: Roadmap; error?: unknown; retryFailed: boolean };

export const roadmapBuild = setup({
  types: {
    context: {} as Context,
    input: {} as { slug: string },
    events: {} as { type: "REFRESH" } | { type: "RETRY" },
  },
  actors: {
    load: fromPromise(({ input, signal }: { input: { slug: string }; signal: AbortSignal }) =>
      trpc.paths.get.query(input, { signal })),
    retry: fromPromise(({ input, signal }: { input: { slug: string }; signal: AbortSignal }) =>
      trpc.paths.retryBuild.mutate(input, { signal })),
  },
}).createMachine({
  context: ({ input }) => ({ slug: input.slug, retryFailed: false }),
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "load",
        input: ({ context }) => ({ slug: context.slug }),
        onDone: {
          target: "loaded",
          actions: assign({ data: ({ event }) => event.output, error: undefined, retryFailed: false }),
        },
        onError: {
          target: "loaded",
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    loaded: {
      after: {
        4_000: {
          guard: ({ context }) => context.data?.build?.state === "planning" || context.data?.build?.state === "building",
          target: "loading",
        },
      },
      on: { REFRESH: "loading", RETRY: "retrying" },
    },
    retrying: {
      entry: assign({ retryFailed: false }),
      invoke: {
        src: "retry",
        input: ({ context }) => ({ slug: context.slug }),
        onDone: "loading",
        onError: { target: "loaded", actions: assign({ retryFailed: true }) },
      },
    },
  },
});
