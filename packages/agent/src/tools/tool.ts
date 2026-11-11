import type { FlightPlanRepository } from '@ofplens/db';
import type {
  HazardClient,
  PlanHazardStore,
  PlanWeatherStore,
  WeatherClient,
} from '@ofplens/weather';
import type { z } from 'zod';

/**
 * What the tools read from. Plain interfaces: the API passes its repositories, tests pass a
 * test database, and the Phase 8 MCP server can pass its own.
 */
export interface ToolDeps {
  flightPlans: Pick<FlightPlanRepository, 'get'>;
  weatherReports: PlanWeatherStore;
  /** Use the cached client: the agent may ask for weather more than once. */
  weather: WeatherClient;
  hazards: PlanHazardStore;
  /** Use the cached client: the feeds cover the whole world and are shared by all plans. */
  hazardFeeds: HazardClient;
}

/**
 * A tool the briefing agent can call: a name and description for the model, Zod schemas for
 * input and output, and a plain async function. No dependency on the agent loop or Fastify.
 */
export interface AgentTool<Input extends z.ZodType, Output extends z.ZodType> {
  name: string;
  description: string;
  input: Input;
  output: Output;
  run(input: z.output<Input>, deps: ToolDeps): Promise<z.output<Output>>;
}

export function defineTool<Input extends z.ZodType, Output extends z.ZodType>(
  tool: AgentTool<Input, Output>,
): AgentTool<Input, Output> {
  return tool;
}

/** A problem the model should hear about as a tool error (bad id, unknown plan), not a crash. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
