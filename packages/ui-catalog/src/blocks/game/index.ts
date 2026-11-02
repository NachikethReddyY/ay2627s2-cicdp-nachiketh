import type { BlockModule } from "../../core/parse.ts";
import { MAX_GRID, MAX_PROGRAM_STEPS, MAX_REPEAT, MAX_REPEAT_BODY, MAX_WALLS, MAX_GEMS } from "./grid.ts";
import { gameSchema, kindOf, type GameProps } from "./schema.ts";
import { MAX_GAME_ALT, MAX_HINTS, MAX_LIVES } from "./shell.ts";

export const gameBlock: BlockModule<GameProps> = {
  type: "game",
  schema: gameSchema,
  check: (b) => kindOf(b.props.kind).check(b.props.kind).map((i) => ({ path: `props.kind.${i.path}`, message: i.message })),
  describe: (b) => {
    const { title, goalText, alt, hints, shell, kind } = b.props;
    const extras = [shell.lives ? `${shell.lives} lives` : "", hints.length ? `${hints.length} hint${hints.length > 1 ? "s" : ""}` : ""].filter(Boolean);
    return `Game: ${title}. Goal: ${goalText} ${alt} ${kindOf(kind).describe(kind)}${extras.length ? ` ${extras.join(", ")}.` : ""}`;
  },
  prompt: `Use \`game\` when the learner should practise a concept by doing it: sequencing, loops, debugging. Every game has \`title\` (up to 60 chars), \`goalText\` (up to 200), \`alt\` (required, up to ${MAX_GAME_ALT}: say how to play and what it teaches), \`hints\` (up to ${MAX_HINTS}, each up to 160 chars), \`shell\` ({} or {"lives": 1 to ${MAX_LIVES}}) and \`kind\`, an object whose own \`kind\` picks the game. The only kind is "grid": a robot on a w by h grid (1 to ${MAX_GRID} each; x and y count from 0, y 0 is the top row, "up" is y - 1) goes from \`start\` {x, y, dir: up, down, left or right} to \`goal\` {x, y}, past \`walls\` (up to ${MAX_WALLS} cells), and must pick every gem in \`gems\` (up to ${MAX_GEMS} cells) before it reaches the goal, which ends the run. Cells never overlap and the start is never the goal. \`commands\` is the palette, some of forward, left, right, pick. A program is a list of commands and repeat blocks {"repeat": 2 to ${MAX_REPEAT}, "body": [up to ${MAX_REPEAT_BODY} commands]}; repeats need \`allowRepeat\` {"maxTimes", "maxBody"} and never nest. Optional \`maxBlocks\` caps program size (a repeat counts as 1 plus its body): use it to make a loop necessary. \`mode\` is watch (play the solution), solve (the learner builds a program) or debug (the learner fixes \`starter\`, a program with one bug). \`maxSteps\` (1 to ${MAX_PROGRAM_STEPS}) caps the commands run. Always include \`solution\`, a program that reaches the goal with every gem; a puzzle that cannot be solved is rejected.
Example: {"type":"game","id":"robot","props":{"title":"Get the gem","goalText":"Pick up the gem, then reach the flag.","alt":"Build a program for a robot on a 4 by 3 grid: drive right to a gem, pick it, then turn and drive down to the flag. Practises putting steps in order.","hints":["Pick the gem before you turn."],"shell":{"lives":3},"kind":{"kind":"grid","size":{"w":4,"h":3},"start":{"x":0,"y":0,"dir":"right"},"goal":{"x":3,"y":2},"walls":[{"x":1,"y":1}],"gems":[{"x":3,"y":0}],"commands":["forward","left","right","pick"],"mode":"solve","maxSteps":12,"solution":["forward","forward","forward","pick","right","forward","forward"]}}}`,
  budget: 2,
};
