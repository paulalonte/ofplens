import type { Briefing } from '@ofplens/agent';
import { createTestDatabase, type TestDatabase } from '@ofplens/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVAL_CASES } from '../cases';
import { prepareCase, runAllTools } from '../setup';
import { gradeBriefing, type Grade } from './grade';
import { oracleBriefing } from './oracle';
import type { Reference } from './reference';

/**
 * The graders against every real case, without Claude: a correct briefing written by code must
 * pass every check, and each kind of mistake must fail the check meant to catch it (and only
 * that one, so two checks never score the same thing).
 */
let testDb: TestDatabase;
const references = new Map<string, Reference>();

beforeAll(async () => {
  testDb = await createTestDatabase();
  for (const evalCase of EVAL_CASES) {
    const prepared = await prepareCase(testDb.db, evalCase);
    references.set(evalCase.id, (await runAllTools(prepared)) as unknown as Reference);
  }
}, 60_000);
afterAll(async () => {
  await testDb.destroy();
});

const reference = (id: string) => references.get(id)!;
const failing = (grade: Grade) => grade.checks.filter((c) => c.pass === false).map((c) => c.id);
const reasons = (grade: Grade) => grade.checks.flatMap((c) => c.reasons).join(' | ');

/** The case's model answer with one change. */
function changed(id: string, change: (b: Briefing) => void): Grade {
  const briefing = oracleBriefing(reference(id));
  change(briefing);
  return gradeBriefing(briefing, reference(id));
}

describe('the model answer', () => {
  it.each(EVAL_CASES.map((c) => c.id))('%s passes every check', (id) => {
    const grade = gradeBriefing(oracleBriefing(reference(id)), reference(id));
    expect(reasons(grade)).toBe('');
    expect(grade.pass).toBe(true);
  });
});

describe('each mistake fails its own check', () => {
  it('no briefing at all fails "valid answer" and the whole run; the rest do not apply', () => {
    const grade = gradeBriefing(null, reference('eddf-lepa-quiet'), 'headline: Too big');
    expect(grade.pass).toBe(false);
    expect(failing(grade)).toEqual(['valid_answer']);
    expect(grade.checks.filter((c) => c.pass === null)).toHaveLength(6);
    expect(grade.checks[0]!.reasons).toEqual(['headline: Too big']);
  });

  it('no invented weather: a hazard bulletin backs a note', () => {
    // The cyclone SIGMET says "CB OBS WI 150NM OF CENTRE".
    expect(
      failing(
        changed('rjtt-vhhh-typhoon', (b) => {
          b.pilotNotes.push('Cumulonimbus within 150 NM of the centre of TC NOVA.');
        }),
      ),
    ).toEqual([]);
  });

  it('guardrails: a hazard left out of enrouteHazards', () => {
    const grade = changed('eddb-eddm-ts-sigmet', (b) => {
      b.enrouteHazards = [];
    });
    expect(failing(grade)).toEqual(['guardrails']);
  });

  it('risk: low on a route with a severe hazard, high on a quiet day', () => {
    expect(
      failing(changed('egll-kjfk-oceanic-turbulence', (b) => (b.overallRisk = 'low'))),
    ).toEqual(['risk']);
    expect(failing(changed('eddf-lepa-quiet', (b) => (b.overallRisk = 'high')))).toEqual(['risk']);
    // Hazards unknown: low and moderate are both fine.
    expect(
      failing(changed('eddf-lepa-hazard-feeds-down', (b) => (b.overallRisk = 'moderate'))),
    ).toEqual([]);
  });

  it('no invented weather: freezing rain at Frankfurt, fog at Palma', () => {
    const notes = changed('eddf-lepa-quiet', (b) => {
      b.pilotNotes.push('Light freezing rain at EDDF before departure.');
    });
    expect(failing(notes)).toEqual(['no_invented_weather']);
    expect(reasons(notes)).toContain(
      'pilot note 1 says "freezing rain", which EDDF does not report.',
    );

    const summary = changed('eddf-lepa-quiet', (b) => {
      b.destination.summary = 'Light wind, fog patches.';
    });
    expect(failing(summary)).toEqual(['no_invented_weather']);
  });

  it('no invented weather: a summary only describes its METAR, at its intensity', () => {
    // LSZH: the METAR has light rain; fog is only in the TAF.
    const fromTaf = changed('loww-lszh-alternate-no-metar', (b) => {
      b.destination.summary = 'Light rain and fog.';
    });
    expect(failing(fromTaf)).toEqual(['no_invented_weather']);
    expect(reasons(fromTaf)).toContain(
      'destination summary says "fog", which the cited METAR does not report.',
    );

    const intensity = changed('loww-lszh-alternate-no-metar', (b) => {
      b.destination.summary = 'Heavy rain.';
    });
    expect(failing(intensity)).toEqual(['no_invented_weather']);
    expect(reasons(intensity)).toContain('"heavy rain", but the METAR has -RA');
  });

  it('no invented weather: real weather and negations pass', () => {
    expect(
      failing(
        changed('engm-bikf-freezing-drizzle', (b) => {
          b.pilotNotes.push(
            'Freezing drizzle and possible freezing fog at ENGM; no thunderstorms.',
          );
        }),
      ),
    ).toEqual([]);
    expect(
      failing(
        changed('rjtt-vhhh-arrival-thunderstorms', (b) => {
          b.pilotNotes.push('Thunderstorms with CB at VHHH around arrival.');
        }),
      ),
    ).toEqual([]);
  });

  it('numbers: wrong wind, cloud height, visibility or pressure', () => {
    const wind = changed('eddf-lepa-arrival-storms', (b) => {
      b.destination.summary = 'Wind 240 at 16 kt gusting 35 kt, few CB.';
    });
    expect(failing(wind)).toEqual(['numbers']);
    expect(reasons(wind)).toContain('METAR: 240/16G28 kt');

    const cloud = changed('eddb-eddm-destination-fog', (b) => {
      b.destination.summary = 'Fog, 200 m visibility, vertical visibility 300 ft.';
    });
    expect(failing(cloud)).toEqual(['numbers']);

    const vis = changed('eddb-eddm-destination-fog', (b) => {
      b.destination.summary = 'Fog, 2,000 m visibility, vertical visibility 100 ft.';
    });
    expect(failing(vis)).toEqual(['numbers']);

    const pressure = changed('ksfo-kjfk-us-feeds-down', (b) => {
      b.destination.summary = 'Wind 310 at 25 kt gusting 38 kt, QNH 1013 hPa.';
    });
    expect(failing(pressure)).toEqual(['numbers']);
  });

  it('hazards in notes: a hazard listed but never mentioned to the pilot', () => {
    const grade = changed('ksfo-kjfk-gairmets', (b) => {
      b.pilotNotes = b.pilotNotes.filter((n) => !n.startsWith('Icing'));
    });
    expect(failing(grade)).toEqual(['hazards_in_notes']);
    expect(reasons(grade)).toContain('No note names the icing (JENNO to PUCKY).');
  });

  it('says what is missing: dispatch weather or unread feeds presented as complete', () => {
    const drop = (id: string, prefix: string) =>
      changed(id, (b) => {
        b.pilotNotes = b.pilotNotes.filter((n) => !n.startsWith(prefix));
      });
    expect(failing(drop('eddb-eddm-weather-down', 'Live weather'))).toEqual([
      'says_what_is_missing',
    ]);
    expect(failing(drop('eddf-lepa-hazard-feeds-down', 'Hazard advisories'))).toEqual([
      'says_what_is_missing',
    ]);
    expect(failing(drop('ksfo-kjfk-us-feeds-down', 'Some hazard feeds'))).toEqual([
      'says_what_is_missing',
    ]);
  });
});
