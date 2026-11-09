import type { PilotRepository } from '@ofplens/db';
import { PilotResponse, PilotSettings } from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

export interface PilotRouteOptions {
  pilots: PilotRepository;
}

/** The pilot's settings: SimBrief username and preferred weight unit. */
export const pilotRoutes: FastifyPluginCallbackZod<PilotRouteOptions> = (app, { pilots }, done) => {
  app.get('/api/pilot', { schema: { response: { 200: PilotResponse } } }, async () => ({
    pilot: await pilots.get(),
  }));

  app.put(
    '/api/pilot',
    { schema: { body: PilotSettings, response: { 200: PilotResponse } } },
    async (request) => ({ pilot: await pilots.save(request.body) }),
  );

  done();
};
