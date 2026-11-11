import { getFlightPlan } from './getFlightPlan';
import { getRouteHazards, MAX_ROUTE_HAZARDS } from './hazards';
import { getPlannedWeather, getWeather } from './weather';

export { defineTool, ToolError, type AgentTool, type ToolDeps } from './tool';
export { getFlightPlan, getPlannedWeather, getRouteHazards, getWeather, MAX_ROUTE_HAZARDS };

/** Everything the briefing agent may call, in the order it would usually call them. */
export const briefingTools = [
  getFlightPlan,
  getPlannedWeather,
  getWeather,
  getRouteHazards,
] as const;
