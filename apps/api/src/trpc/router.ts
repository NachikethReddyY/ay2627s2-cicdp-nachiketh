import { router } from "./trpc.ts";
import { lessonsRouter } from "../lessons/router.ts";
import { stepsRouter } from "../attempts/router.ts";
import { coursesRouter, gamesRouter, homeRouter, meRouter, pathsRouter } from "../progress/router.ts";
import { partsRouter } from "../parts/router.ts";

export const appRouter = router({
  home: homeRouter,
  paths: pathsRouter,
  courses: coursesRouter,
  me: meRouter,
  games: gamesRouter,
  parts: partsRouter,
  lessons: lessonsRouter,
  steps: stepsRouter,
});

export type AppRouter = typeof appRouter;
