export { parseSpec, BLOCKS, type Block, type BlockModule, type Issue, type ParseResult, type Spec } from "./core/parse.ts";
export { blockSchema, envelopeSchema } from "./core/envelope.ts";
export { sanitize, text } from "./core/sanitize.ts";
export { MAX_SPEC_BYTES, MIN_BLOCKS, MAX_BLOCKS, MAX_ALT, ID_RE, THEME_COLORS, id, color, alt } from "./core/caps.ts";
export { RESERVED } from "./core/reserved.ts";
export {
  timelineSchema,
  stateAt,
  stepCount,
  clampStep,
  MAX_STEPS,
  MAX_SET,
  MIN_STEP_MS,
  MAX_STEP_MS,
  type Timeline,
  type TimelineState,
  type TimelineValue,
} from "./core/timeline.ts";
export { parseExpr, evalExpr, MAX_EXPR_LEN, MAX_EXPR_DEPTH, MAX_EXPR_NODES, FUNCTIONS, type Ast, type ParseExprResult } from "./core/expr.ts";
export { chartBlock, type ChartProps, sliderValue, table as chartTable, DEFAULT_DOMAIN, MAX_SERIES, MAX_POINTS, MAX_SLIDERS } from "./blocks/chart/index.ts";
export { stageBlock, type StageProps, ANIMATABLE, MAX_SHAPES } from "./blocks/stage/index.ts";
export { scene3dBlock, type Scene3dProps, vec3Value, ANIMATABLE as SCENE3D_ANIMATABLE, MAX_PRIMITIVES, MAX_GROUPS, KINDS as SCENE3D_KINDS, CAMERAS, LIGHTS, MATERIALS } from "./blocks/scene3d/index.ts";
export { gameBlock } from "./blocks/game/index.ts";
export { GAME_KINDS, gameSchema, type GameProps, type GameKindProps } from "./blocks/game/schema.ts";
export { MAX_HINTS, MAX_LIVES, MAX_GAME_ALT, type GameKind, type ShellProps } from "./blocks/game/shell.ts";
export {
  simulate,
  solvable,
  programIssues,
  blockCount,
  gridKind,
  GRID_COMMANDS,
  GRID_MODES,
  DIRS,
  MAX_GRID,
  MAX_WALLS,
  MAX_GEMS,
  MAX_PROGRAM_STEPS,
  MIN_REPEAT,
  MAX_REPEAT,
  MAX_REPEAT_BODY,
  type GridProps,
  type GridProgram,
  type GridStep,
  type GridCommand,
  type RepeatStep,
  type GridRun,
  type GridState,
  type GridTraceStep,
  type Cell,
  type Dir,
} from "./blocks/game/grid.ts";
