import lesson from "./fixtures/lesson1";
import { buildTimeline } from "@learnquest/player-core";
import Player from "./Player";

const titles = lesson.steps.map((s) => s.title);
const examples = lesson.steps.map((s) => s.explanations.workedExample);
const timeline = buildTimeline(lesson.steps.map((s) => s.input));

// Dev only: ?mode= previews the task or video layout of the bundled sample.
const modeParam = new URLSearchParams(location.search).get("mode");
const mode = modeParam === "task" || modeParam === "video" ? modeParam : lesson.mode;

export default function FixturePlayer() {
  return <Player title={lesson.title} stepTitles={titles} timeline={timeline} sample={{ mode, examples }} />;
}
