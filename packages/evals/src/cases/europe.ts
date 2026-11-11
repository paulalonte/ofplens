import { defineCase } from '../case';

/**
 * Cases on the three European plans. Briefings are asked for 20 minutes before Out unless a case
 * says otherwise; airports not set get their dispatch weather again.
 */

const NO_HAZARDS = { advisories: [] };

/** EDDB → EDDM, Citation X. Dispatch: both IFR (low cloud), fog in the EDDB TAF overnight. */
export const eddbEddm = [
  defineCase({
    id: 'eddb-eddm-ts-sigmet',
    plan: 'eddb-eddm-c750-kgs',
    title: 'Embedded thunderstorms on the route near PIKIB, weather as at dispatch',
    tags: ['hazard', 'thunderstorm'],
    expect:
      'Names the embedded thunderstorm SIGMET on LUROS → VESUB, up to FL380, in ' +
      'enrouteHazards and a pilot note. Both airports IFR with low cloud. Risk moderate.',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['EDUU', 'EDUU RHEIN UIR'],
          seriesId: 'W1',
          hazard: 'TS',
          qualifier: 'EMBD',
          over: ['BEBKU', 'PIKIB', 'MAREM'],
          baseFt: null,
          topFt: 38000,
          text: 'EMBD TS FCST TOP FL380 MOV NE 15KT NC',
        },
      ],
    },
  }),
  defineCase({
    id: 'eddb-eddm-destination-fog',
    plan: 'eddb-eddm-c750-kgs',
    title: 'Munich has gone LIFR in fog since dispatch',
    tags: ['airport', 'worse since dispatch', 'LIFR'],
    expect:
      'EDDM LIFR in fog (200 m, vertical visibility 100 ft), changed since dispatch, slowly ' +
      'lifting in the TAF. Risk high (destination LIFR).',
    weather: {
      destination: {
        metar: '00000KT 0200 FG VV001 04/04 Q1019 BECMG 0800',
        taf: '{0}/{24} 00000KT 0300 FG VV001 BECMG {+2}/{+4} 1500 BR OVC003 BECMG {+8}/{+10} 6000 BKN008',
      },
    },
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'eddb-eddm-weather-down',
    plan: 'eddb-eddm-c750-kgs',
    title: 'aviationweather.gov is down: only the dispatch weather is available',
    tags: ['degraded', 'no live weather'],
    expect:
      'Uses the dispatch METARs (both IFR), cites dispatch reports, changedSinceDispatch false; ' +
      'may say live weather was unavailable. Never claims current conditions it was not given. ' +
      'Risk moderate.',
    weather: 'unavailable',
    hazards: NO_HAZARDS,
  }),
];

/** EDDF → LEPA, A330-900, no alternate. Dispatch: EDDF MVFR, LEPA VFR. Arrival about 2215Z. */
export const eddfLepa = [
  defineCase({
    id: 'eddf-lepa-quiet',
    plan: 'eddf-lepa-a339-noalt',
    title: 'Quiet evening: weather as at dispatch, nothing on the route',
    tags: ['quiet'],
    expect:
      'EDDF broken cloud at 2,500 ft (MVFR), LEPA light wind and few clouds (VFR), no alternate, ' +
      'no hazards. Risk low. Nothing added that the reports do not say.',
    weather: {},
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'eddf-lepa-arrival-storms',
    plan: 'eddf-lepa-a339-noalt',
    title: 'Gusty at Palma, thunderstorms in the TAF around arrival',
    tags: ['airport', 'TAF at arrival', 'gusts'],
    expect:
      'LEPA wind 240 at 16 gusting 28 kt with CB about; the TAF has TEMPO thunderstorms with ' +
      'gusts to 40 kt from about 2100Z to 0000Z, covering the arrival. Risk moderate.',
    weather: {
      destination: {
        metar: '24016G28KT 9999 FEW030CB SCT040 22/15 Q1010',
        taf: '{0}/{24} 24015G25KT 9999 FEW030CB TEMPO {+2}/{+5} 24025G40KT 3000 TSRA BKN015CB BECMG {+6}/{+8} 27010KT 9999 SCT030',
      },
    },
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'eddf-lepa-hazard-feeds-down',
    plan: 'eddf-lepa-a339-noalt',
    title: 'Every hazard feed is down: hazards on the route are unknown',
    tags: ['degraded', 'no hazard feeds'],
    expect:
      'enrouteHazards empty; does not claim the route is clear of hazards (says advisories ' +
      'could not be checked). Weather as at dispatch. Risk low or moderate.',
    weather: {},
    hazards: 'unavailable',
  }),
];

/** LOWW → LSZH, Citation X, alternate LSMP. Dispatch: LOWW LIFR (mist), LSZH and LSMP MVFR. */
export const lowwLszh = [
  defineCase({
    id: 'loww-lszh-mountain-wave',
    plan: 'loww-lszh-c750-kgs',
    title: 'Severe mountain wave over the northern Alps at cruise level',
    tags: ['hazard', 'mountain wave', 'severe'],
    expect:
      'Names the severe mountain wave SIGMET on MATIG → KONIN, FL250 to FL360. LOWW LIFR ' +
      'in mist. Risk high (severe hazard).',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['LOVV', 'LOVV WIEN FIR'],
          seriesId: 'M2',
          hazard: 'MTW',
          qualifier: 'SEV',
          over: ['TRAUN', 'ATLOL', 'MANAL'],
          baseFt: 25000,
          topFt: 36000,
          text: 'SEV MTW OBS AT 1830Z FL250/360 STNR NC',
        },
      ],
    },
  }),
  defineCase({
    id: 'loww-lszh-destination-fog',
    plan: 'loww-lszh-c750-kgs',
    title: 'Zurich has gone LIFR in fog since dispatch',
    tags: ['airport', 'worse since dispatch', 'LIFR'],
    expect:
      'LSZH LIFR in fog (150 m, vertical visibility 100 ft), changed since dispatch; LOWW LIFR in ' +
      'mist; LSMP as at dispatch. Risk high (destination LIFR).',
    weather: {
      destination: {
        metar: '00000KT 0150 FG VV001 08/08 Q1006 BECMG 0400',
        taf: '{0}/{24} 00000KT 0200 FG VV001 BECMG {+12}/{+14} 3000 BR BKN004',
      },
    },
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'loww-lszh-alternate-no-metar',
    plan: 'loww-lszh-c750-kgs',
    title: 'No live METAR or TAF for the alternate (LSMP)',
    tags: ['degraded', 'missing report'],
    expect:
      'Alternate based on the LSMP dispatch METAR (cited as dispatch, changedSinceDispatch ' +
      'false). LOWW LIFR in mist, LSZH light rain. Risk moderate.',
    weather: { alternate: { metar: null, taf: null } },
    hazards: NO_HAZARDS,
  }),
];

/** ENGM → BIKF, A320, alternate BIAR. Dispatch: ENGM LIFR in freezing drizzle, BIKF CAVOK. */
export const engmBikf = [
  defineCase({
    id: 'engm-bikf-freezing-drizzle',
    plan: 'engm-bikf-a320-kgs',
    title: 'Real dispatch weather: freezing drizzle at Oslo, nothing on the route',
    tags: ['airport', 'freezing', 'LIFR'],
    expect:
      'ENGM LIFR: light freezing drizzle, mist, vertical visibility 300 ft, TEMPO freezing fog. ' +
      'BIKF CAVOK with 15 kt wind; BIAR light snow showers. Risk moderate (departure LIFR, not ' +
      'getting worse).',
    weather: {},
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'engm-bikf-destination-snow',
    plan: 'engm-bikf-a320-kgs',
    title: 'Keflavik has gone LIFR in heavy snow and strong wind since dispatch',
    tags: ['airport', 'worse since dispatch', 'LIFR', 'gusts'],
    expect:
      'BIKF LIFR: wind 360 at 28 gusting 40 kt, 800 m in heavy snow and drifting snow, vertical ' +
      'visibility 400 ft, changed since dispatch. Risk high (destination LIFR).',
    weather: {
      destination: {
        metar: '36028G40KT 0800 +SN DRSN VV004 M04/M05 Q1008',
        taf: '{0}/{24} 36025G38KT 1200 SN DRSN VV006 TEMPO {0}/{+6} 0500 +SN VV003 BECMG {+8}/{+10} 03015KT 5000 -SN BKN012',
      },
    },
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'engm-bikf-severe-icing',
    plan: 'engm-bikf-a320-kgs',
    title: 'Severe icing on the descent into Keflavik',
    tags: ['hazard', 'icing', 'severe'],
    expect:
      'Names the severe icing SIGMET on the descent, 5,000 ft to FL250, as two entries ' +
      '(NASBU → KF187 and SONAX → BIKF). ' +
      'ENGM LIFR in freezing drizzle. Risk high (severe hazard).',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['BIRD', 'BIRD REYKJAVIK FIR'],
          seriesId: 'I3',
          hazard: 'ICE',
          qualifier: 'SEV',
          over: ['KF184', 'SOTUG', 'KF185', 'KF186'],
          baseFt: 5000,
          topFt: 25000,
          text: 'SEV ICE FCST FL050/250 MOV E 10KT NC',
        },
      ],
    },
  }),
];
