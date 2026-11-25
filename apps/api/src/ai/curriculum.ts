import { z } from "zod";
import { env } from "../env.ts";
import { reserveAiSpend, ENGINE_CALLS_PER_REPLY } from "../config/budget.ts";
import { callEngine } from "../engine-client/client.ts";
import { JS_EDGES } from "../progress/catalogue.ts";
import { isSafeText } from "../safety/moderation.ts";
import type { LearnerMemory } from "./generator.ts";
import { text } from "./step-schema.ts";
import { measureGeneration } from "./telemetry.ts";

const TopicId = text(60).regex(/^[a-z0-9][a-z0-9.-]*$/);
const Topic = z.object({
  id: TopicId,
  title: text(80),
  outcome: text(300),
  prerequisites: z.array(TopicId).max(20),
});
const MAX_LESSONS = 1000;
const BATCH_SIZE = 12;
const Section = z.object({
  title: text(80),
  description: text(300),
  units: z.array(z.object({ topicId: TopicId, lessonCount: z.int().min(1).max(MAX_LESSONS) })).min(1).max(100),
});
const Layout = z.object({
  title: text(80),
  tagline: text(160),
  startingPoint: text(300),
  destination: text(300),
  topics: z.array(Topic).min(1).max(100),
  sections: z.array(Section).min(1).max(100),
});
export class CurriculumRefused extends Error {}

const Refusal = z.object({ refused: z.literal(true) });
const Requested = z.object({ topics: z.array(z.object({ id: TopicId, title: text(80) })).min(1).max(100) });
const RequestedReply = z.union([Refusal, Requested]);
const LessonBatch = z.object({ lessons: z.array(z.object({
  title: text(80),
  objective: text(300),
  kind: z.enum(["learn", "watch", "predict", "practice", "game-practice", "scrim"]),
})).min(1).max(BATCH_SIZE) });

const Checkpoint = z.object({
  requested: Requested.optional(),
  layout: Layout.optional(),
  units: z.array(z.object({ topicId: TopicId, lessons: z.array(LessonBatch.shape.lessons.element).max(MAX_LESSONS) })).max(100),
});

type Checkpoint = z.infer<typeof Checkpoint>;
export type SavePlanCheckpoint = (checkpoint: Checkpoint) => Promise<void>;

type Layout = z.infer<typeof Layout>;
type BatchLesson = z.infer<typeof LessonBatch>["lessons"][number];
type PlannedLesson = BatchLesson & { level: number; concepts: string[] };

export type Curriculum = {
  title: string;
  tagline: string;
  roadmap: { startingPoint: string; destination: string; topics: { title: string; outcome: string }[] };
  courses: { title: string; description: string; lessons: PlannedLesson[] }[];
};

function validateLayout(layout: Layout, requested: z.infer<typeof Requested>) {
  const byId = new Map(layout.topics.map((topic) => [topic.id, topic]));
  if (requested.topics.some((topic) => !byId.has(topic.id))) {
    throw new Error("Roadmap is missing a requested topic");
  }
  const taught = new Set<string>();
  let count = 0;
  for (const section of layout.sections) {
    for (const unit of section.units) {
      const topic = byId.get(unit.topicId);
      if (!topic || taught.has(topic.id) || topic.prerequisites.some((id) => !taught.has(id))) {
        throw new Error("Roadmap topics must appear once and follow their prerequisites");
      }
      if (JS_EDGES.some(([pre, target]) => topic.id === target && byId.has(pre) && !taught.has(pre))) {
        throw new Error("Roadmap topics must preserve catalogue prerequisite order");
      }
      taught.add(topic.id);
      count += unit.lessonCount;
    }
  }
  if (taught.size !== layout.topics.length || count > MAX_LESSONS) {
    throw new Error("Roadmap is missing topics or exceeds its lesson limit");
  }
  return byId;
}

async function planCall<T>(route: `/v1/${string}`, body: unknown, parse: (raw: unknown) => T): Promise<T> {
  await reserveAiSpend(env.AI_CALL_ESTIMATE_USD * ENGINE_CALLS_PER_REPLY);
  const raw = await measureGeneration("outline", () => callEngine<{ plan: unknown }>(route, body, { timeoutMs: env.OUTLINE_TIMEOUT_MS }));
  const value = parse(raw.plan);
  const serialized = JSON.stringify(value);
  for (let offset = 0; offset < serialized.length; offset += 8_000) {
    if (!(await isSafeText(serialized.slice(offset, offset + 8_000)))) {
      throw new CurriculumRefused("Generated plan refused by safety filter");
    }
  }
  return value;
}

export async function planCurriculum(prompt: string, learnerMemory: LearnerMemory, saved: unknown, save: SavePlanCheckpoint): Promise<Curriculum> {
  const checkpoint: Checkpoint = saved === null ? { units: [] } : Checkpoint.parse(saved);
  if (!checkpoint.requested) {
    const requested = await planCall("/v1/pipeline/roadmap-topics", { topic: prompt }, (raw) => RequestedReply.parse(raw));
    if ("refused" in requested) throw new CurriculumRefused("Topic refused by curriculum planner");
    checkpoint.requested = requested;
    await save(checkpoint);
  }
  if (!checkpoint.layout) {
    const layout = await planCall("/v1/pipeline/roadmap", { topic: prompt, learnerMemory, requested: checkpoint.requested.topics }, (raw) => Layout.parse(raw));
    validateLayout(layout, checkpoint.requested);
    checkpoint.layout = layout;
    await save(checkpoint);
  }
  const layout = checkpoint.layout;
  const topics = validateLayout(layout, checkpoint.requested);
  const savedUnits = new Map(checkpoint.units.map(({ topicId, lessons }) => [topicId, lessons]));
  const saveUnit = async (topicId: string, lessons: BatchLesson[]) => {
    savedUnits.set(topicId, lessons);
    checkpoint.units = [...savedUnits].map(([id, unit]) => ({ topicId: id, lessons: unit }));
    await save(checkpoint);
  };
  const courses: Curriculum["courses"] = [];
  const orderedTopics: Curriculum["roadmap"]["topics"] = [];
  for (const { title, description, units } of layout.sections) {
    const lessons: PlannedLesson[] = [];
    for (const [index, { topicId, lessonCount }] of units.entries()) {
      const topic = topics.get(topicId)!;
      const unit = savedUnits.get(topicId) ?? [];
      for (let offset = unit.length; offset < lessonCount; offset += BATCH_SIZE) {
        const count = Math.min(BATCH_SIZE, lessonCount - offset);
        const batch = await planCall("/v1/pipeline/roadmap-batch", {
          pathTitle: layout.title,
          sectionTitle: title,
          sectionOutcome: description,
          topic: topic.title,
          outcome: topic.outcome,
          offset,
          count,
          total: lessonCount,
          previous: unit.slice(-BATCH_SIZE).map(({ title, objective }) => ({ title, objective })),
        }, (raw) => LessonBatch.parse(raw).lessons);
        if (batch.length !== count || (offset === 0 && batch[0]?.kind !== "learn")) {
          throw new Error("Roadmap batch does not match its planned lesson count or teaching order");
        }
        const candidate = [...unit, ...batch];
        if (new Set(candidate.map((lesson) => lesson.title.toLowerCase())).size !== candidate.length) {
          throw new Error("Roadmap contains duplicate lesson titles for a topic");
        }
        if (candidate.length === lessonCount && lessonCount > 1
          && !candidate.some((lesson) => lesson.kind !== "learn" && lesson.kind !== "watch")) {
          throw new Error("Each multi-lesson topic needs an aligned check or exercise");
        }
        unit.push(...batch);
        await saveUnit(topicId, unit);
      }
      orderedTopics.push({ title: topic.title, outcome: topic.outcome });
      lessons.push(...unit.map((lesson) => ({ ...lesson, level: index + 1, concepts: [topicId] })));
    }
    courses.push({ title, description, lessons });
  }
  return { title: layout.title, tagline: layout.tagline, roadmap: { startingPoint: layout.startingPoint, destination: layout.destination, topics: orderedTopics }, courses };
}
