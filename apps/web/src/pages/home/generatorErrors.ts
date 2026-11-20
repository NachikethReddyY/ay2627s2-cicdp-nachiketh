const aiErrors: Record<string, string> = {
  PRECONDITION_FAILED: "Path generation isn't switched on here yet.",
  TOO_MANY_REQUESTS: "You've generated 5 paths today. Try again tomorrow.",
  BAD_REQUEST: "We only generate coding paths. Try a language, a tool or a project idea.",
  TIMEOUT: "That path took too long to generate. Try again in a moment.",
  INTERNAL_SERVER_ERROR: "Path generation is having trouble right now. Try again in a moment.",
};

const networkError = "We couldn't generate that path. Check your connection and try again.";

export const generatorError = (code: string | null): string => (code === null ? networkError : (aiErrors[code] ?? networkError));
