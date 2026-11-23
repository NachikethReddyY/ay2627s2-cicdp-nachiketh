export const mvpLimits = { aiPathsPerDay: 5, imagesPerDay: 1 } as const;

export const proLimits = { aiPathsPerDay: 25, imagesPerDay: 10 } as const;

export const feedbackLimits = { name: 120, email: 254, location: 500, details: 4_000, screenshotBytes: 2 * 1024 * 1024 } as const;

export type PlanStatus = "available" | "coming-soon";

export type Plan = {
  id: "free" | "pro";
  name: string;
  status: PlanStatus;
  summary: string;
  limits: readonly string[];
};

export const plans: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    status: "available",
    summary: "Everything you need to learn JavaScript and TypeScript today.",
    limits: [
      `${mvpLimits.aiPathsPerDay} AI-generated learning paths in any rolling 24 hours`,
      `${mvpLimits.imagesPerDay} AI-generated image in any rolling 24 hours`,
      "Programming only: JavaScript and TypeScript",
      "Published lessons, practice, hints and mastery tracking",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    status: "coming-soon",
    summary: "Higher limits, and the advanced track for real code changes. Not available yet, and no price is set.",
    limits: [
      `${proLimits.aiPathsPerDay} AI-generated learning paths in any rolling 24 hours`,
      `${proLimits.imagesPerDay} AI-generated images in any rolling 24 hours`,
      "Advanced track: real code changes, coming soon",
    ],
  },
];
