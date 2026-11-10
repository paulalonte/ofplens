import type { Briefing, Conditions } from './briefing';

/**
 * Checks a briefing against the tool results of the same run. Each problem is a sentence; an
 * empty list means the briefing can be stored as done. Words come from the model; every label
 * and citation must match what the tools returned.
 */

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  /** The tool's output when ok. */
  output?: unknown;
  error?: string;
  ms: number;
}

interface ReportEvidence {
  icao: string;
  kind: 'metar' | 'taf';
  flightCategory: string | null;
}

export interface Evidence {
  /** From get_flight_plan; null when the model never called it. */
  airports: Map<'origin' | 'destination' | 'alternate', string> | null;
  waypointIdents: Set<string>;
  /** Every report any weather tool returned, by reportId. */
  reports: Map<string, ReportEvidence>;
  /** changedSinceDispatch per ICAO from get_weather; null when it was never called. */
  liveChanged: Map<string, boolean> | null;
  /** Advisory ids a tool returned (route hazards arrive in Phase 6). */
  advisoryIds: Set<string>;
}

type Station = {
  icao: string;
  metar?: Report | null;
  taf?: Report | null;
  changedSinceDispatch?: boolean;
};
type Report = { reportId: string; flightCategory?: string | null };

/** Builds the evidence from the successful tool calls of a run. */
export function collectEvidence(calls: ToolCallRecord[]): Evidence {
  const evidence: Evidence = {
    airports: null,
    waypointIdents: new Set(),
    reports: new Map(),
    liveChanged: null,
    advisoryIds: new Set(),
  };

  for (const call of calls) {
    if (!call.ok) continue;
    if (call.name === 'get_flight_plan') {
      const out = call.output as {
        airports: { role: string; icao: string }[];
        waypoints: { ident: string }[];
      };
      evidence.airports = new Map(
        out.airports.map((a) => [a.role as 'origin' | 'destination' | 'alternate', a.icao]),
      );
      for (const w of out.waypoints) evidence.waypointIdents.add(w.ident);
    }
    if (call.name === 'get_planned_weather' || call.name === 'get_weather') {
      const out = call.output as { stations: Station[] };
      for (const s of out.stations) {
        if (s.metar) {
          evidence.reports.set(s.metar.reportId, {
            icao: s.icao,
            kind: 'metar',
            flightCategory: s.metar.flightCategory ?? null,
          });
        }
        if (s.taf)
          evidence.reports.set(s.taf.reportId, { icao: s.icao, kind: 'taf', flightCategory: null });
      }
      if (call.name === 'get_weather') {
        evidence.liveChanged ??= new Map();
        for (const s of out.stations)
          evidence.liveChanged.set(s.icao, s.changedSinceDispatch ?? false);
      }
    }
  }
  return evidence;
}

/** Figures and topics the model must not write: those come from the plan, not the agent. */
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  {
    pattern: /\b\d[\d,.]*\s*(?:kgs?|kilograms?|lbs?|pounds?|tonnes?)\b/i,
    what: 'a weight or fuel quantity',
  },
  {
    pattern:
      /\b(?:fuel|payload|zero fuel weight|takeoff weight|landing weight|block time|flight time)\b/i,
    what: 'fuel, weights or block/flight time',
  },
  { pattern: /\b\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|mins?|minutes?)\b/i, what: 'a duration' },
  { pattern: /\b\d{1,2}:\d{2}\b(?!\s*Z)/, what: 'a duration or a time without Z' },
];

export function checkBriefing(briefing: Briefing, evidence: Evidence): string[] {
  const problems: string[] = [];

  if (!evidence.airports) {
    problems.push('The briefing was written without reading the flight plan (get_flight_plan).');
  } else {
    const blocks: [
      'origin' | 'destination' | 'alternate',
      'departure' | 'destination' | 'alternate',
      Conditions | null,
    ][] = [
      ['origin', 'departure', briefing.departure],
      ['destination', 'destination', briefing.destination],
      ['alternate', 'alternate', briefing.alternate],
    ];
    for (const [role, field, conditions] of blocks) {
      const expected = evidence.airports.get(role) ?? null;
      if (expected === null && conditions !== null) {
        problems.push(
          `${field}: the flight plan has no alternate, but the briefing describes one.`,
        );
        continue;
      }
      if (expected !== null && conditions === null) {
        problems.push(
          `${field}: the flight plan's ${field} ${expected} is missing from the briefing.`,
        );
        continue;
      }
      if (conditions) problems.push(...checkConditions(field, expected!, conditions, evidence));
    }
  }

  for (const hazard of briefing.enrouteHazards) {
    if (!evidence.advisoryIds.has(hazard.advisoryId)) {
      problems.push(`Hazard cites advisory "${hazard.advisoryId}", which no tool returned.`);
    }
    for (const waypoint of [hazard.fromWaypoint, hazard.toWaypoint]) {
      if (!evidence.waypointIdents.has(waypoint)) {
        problems.push(`Hazard names waypoint "${waypoint}", which is not in the flight plan.`);
      }
    }
  }

  const texts = [
    ['headline', briefing.headline],
    ['departure summary', briefing.departure.summary],
    ['destination summary', briefing.destination.summary],
    ...(briefing.alternate ? [['alternate summary', briefing.alternate.summary]] : []),
    ...briefing.pilotNotes.map((note, i) => [`pilot note ${i + 1}`, note]),
  ] as [string, string][];
  for (const [where, text] of texts) {
    for (const { pattern, what } of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) problems.push(`The ${where} mentions ${what} ("${match[0]}").`);
    }
  }

  return problems;
}

function checkConditions(
  field: string,
  expectedIcao: string,
  conditions: Conditions,
  evidence: Evidence,
): string[] {
  const problems: string[] = [];
  if (conditions.icao !== expectedIcao) {
    problems.push(
      `${field}: says ${conditions.icao}, but the flight plan's ${field} is ${expectedIcao}.`,
    );
  }

  const report = evidence.reports.get(conditions.sourceReportId);
  if (!report) {
    problems.push(
      `${field}: cites "${conditions.sourceReportId}", which no weather tool returned.`,
    );
    return problems;
  }
  if (report.icao !== expectedIcao) {
    problems.push(`${field}: cites a report for ${report.icao}, not ${expectedIcao}.`);
  }
  if (report.kind !== 'metar') {
    problems.push(`${field}: cites a TAF; conditions must be based on a METAR.`);
  } else if (conditions.flightCategory !== report.flightCategory) {
    problems.push(
      `${field}: says ${conditions.flightCategory ?? 'no category'}, but the cited METAR is ${report.flightCategory ?? 'without category'}.`,
    );
  }

  const changed = evidence.liveChanged?.get(expectedIcao) ?? false;
  const citesLive = conditions.sourceReportId.startsWith('live:');
  if (conditions.changedSinceDispatch !== (citesLive && changed)) {
    problems.push(
      `${field}: changedSinceDispatch is ${conditions.changedSinceDispatch}, but the weather tools say ${citesLive && changed}.`,
    );
  }
  return problems;
}
