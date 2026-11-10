import { getFlightPlan } from './getFlightPlan';
import { getPlannedWeather, getWeather } from './weather';

export { defineTool, ToolError, type AgentTool, type ToolDeps } from './tool';
export { getFlightPlan, getPlannedWeather, getWeather };

/** Everything the briefing agent may call, in the order it would usually call them. */
export const briefingTools = [getFlightPlan, getPlannedWeather, getWeather] as const;
