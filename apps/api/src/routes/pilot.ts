import type { PilotRepository } from '@ofplens/db';
import { PilotResponse, PilotSettings } from '@ofplens/ofp';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { signedIn } from '../auth/sessions';

export interface PilotRouteOptions {
  pilots: PilotRepository;
}

/** The signed-in pilot's settings: SimBrief username and preferred weight unit. */
export const pilotRoutes: FastifyPluginCallbackZod<PilotRouteOptions> = (app, { pilots }, done) => {
  app.get('/api/pilot', { schema: { response: { 200: PilotResponse } } }, async (request) => ({
    pilot: await pilots.get(signedIn(request).id),
  }));

  app.put(
    '/api/pilot',
    { schema: { body: PilotSettings, response: { 200: PilotResponse } } },
    async (request) => ({ pilot: await pilots.save(signedIn(request).id, request.body) }),
  );

  done();
};
