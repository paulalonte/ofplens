import type { Briefing, Conditions, EnrouteHazard } from './briefing';

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
  /** Whether get_route_hazards was called at all (it may have failed). */
  hazardsChecked: boolean;
  /** Every advisory get_route_hazards returned, by advisoryId. */
  advisories: Map<string, AdvisoryEvidence>;
}

interface AdvisoryEvidence {
  type: string;
  severity: string | null;
  validUntil: string;
  /** "FROM>TO" per segment. */
  segments: Set<string>;
  /** For messages: "turbulence from BEBKU to MAREM". */
  label: string;
}

const segmentKey = (from: string, to: string) => `${from}>${to}`;

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
    hazardsChecked: false,
    advisories: new Map(),
  };

  for (const call of calls) {
    if (call.name === 'get_route_hazards') evidence.hazardsChecked = true;
    if (!call.ok) continue;
    if (call.name === 'get_route_hazards') {
      const out = call.output as {
        hazards: {
          advisoryId: string;
          type: string;
          severity: string | null;
          validUntil: string;
          segments: { fromWaypoint: string; toWaypoint: string }[];
        }[];
      };
      for (const h of out.hazards) {
        const first = h.segments[0];
        evidence.advisories.set(h.advisoryId, {
          type: h.type,
          severity: h.severity,
          validUntil: h.validUntil,
          segments: new Set(h.segments.map((s) => segmentKey(s.fromWaypoint, s.toWaypoint))),
          label: `${h.type.replaceAll('_', ' ')}${first ? ` from ${first.fromWaypoint} to ${first.toWaypoint}` : ''}`,
        });
      }
    }
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

  if (!evidence.hazardsChecked) {
    problems.push('The briefing was written without checking route hazards (get_route_hazards).');
  }
  for (const hazard of briefing.enrouteHazards) {
    problems.push(...checkHazard(hazard, evidence));
  }
  const cited = new Set(briefing.enrouteHazards.map((h) => h.advisoryId));
  for (const [id, advisory] of evidence.advisories) {
    if (!cited.has(id)) {
      problems.push(`Hazard "${id}" (${advisory.label}) is missing from enrouteHazards.`);
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

function checkHazard(hazard: EnrouteHazard, evidence: Evidence): string[] {
  const problems: string[] = [];
  for (const waypoint of [hazard.fromWaypoint, hazard.toWaypoint]) {
    if (!evidence.waypointIdents.has(waypoint)) {
      problems.push(`Hazard names waypoint "${waypoint}", which is not in the flight plan.`);
    }
  }
  const advisory = evidence.advisories.get(hazard.advisoryId);
  if (!advisory) {
    problems.push(`Hazard cites advisory "${hazard.advisoryId}", which no tool returned.`);
    return problems;
  }
  const id = hazard.advisoryId;
  if (hazard.type !== advisory.type) {
    problems.push(`Hazard "${id}": says ${hazard.type}, but the advisory is ${advisory.type}.`);
  }
  if (hazard.severity !== advisory.severity) {
    problems.push(
      `Hazard "${id}": says severity ${hazard.severity ?? 'none'}, but the advisory has ${advisory.severity ?? 'none'}.`,
    );
  }
  if (
    hazard.validUntil === null ||
    Date.parse(hazard.validUntil) !== Date.parse(advisory.validUntil)
  ) {
    problems.push(
      `Hazard "${id}": says valid until ${hazard.validUntil ?? 'unknown'}, but the advisory is valid until ${advisory.validUntil}.`,
    );
  }
  if (!advisory.segments.has(segmentKey(hazard.fromWaypoint, hazard.toWaypoint))) {
    problems.push(
      `Hazard "${id}": ${hazard.fromWaypoint} to ${hazard.toWaypoint} is not one of the advisory's route segments.`,
    );
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
