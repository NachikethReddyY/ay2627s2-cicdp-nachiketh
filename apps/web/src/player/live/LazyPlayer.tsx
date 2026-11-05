import { lazy } from "react";

// The player pulls in Monaco; only lessons with a code window load it.
export const Player = lazy(() => import("../Player"));
