import { defineCase } from '../case';

/** Cases on the US, transatlantic and Asian plans. */

const NO_HAZARDS = { advisories: [] };

/**
 * KSFO → KJFK, B737-900, alternate KEWR, weights in lb. Dispatch (1856Z): KSFO LIFR in mist,
 * JFK and EWR VFR and gusty. Briefed at 0030Z on 10 Nov, arrival about 0610Z.
 */
export const ksfoKjfk = [
  defineCase({
    id: 'ksfo-kjfk-severe-turbulence',
    plan: 'ksfo-kjfk-b739-lbs',
    title: 'Severe turbulence over Wyoming at cruise; San Francisco has cleared since dispatch',
    tags: ['hazard', 'turbulence', 'severe', 'better since dispatch'],
    expect:
      'Names the severe turbulence SIGMET on BAM → KATES, FL300 to FL400. KSFO now VFR ' +
      '(changed since dispatch, better). Risk high (severe hazard).',
    weather: { origin: { metar: '29012KT 10SM FEW250 15/11 A3010' } },
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['KZLC', 'KZLC SALT LAKE CITY'],
          seriesId: 'T4',
          hazard: 'TURB',
          qualifier: 'SEV',
          over: ['LCU', 'OCS'],
          baseFt: 30000,
          topFt: 40000,
          text: 'SEV TURB FCST FL300/400 STNR NC',
        },
      ],
    },
  }),
  defineCase({
    id: 'ksfo-kjfk-gairmets',
    plan: 'ksfo-kjfk-b739-lbs',
    title: 'Moderate G-AIRMETs: turbulence over Iowa at cruise, icing on the descent',
    tags: ['hazard', 'G-AIRMET', 'moderate'],
    expect:
      'Names both: moderate turbulence on OCS → KG75M (FL300 to FL390) and moderate icing on ' +
      'the descent, JENNO → PUCKY (12,000 ft to FL220). KSFO LIFR in mist. Risk moderate.',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'gairmet',
          hazard: 'TURB-HI',
          tag: '2W',
          severity: 'MOD',
          dueTo: null,
          over: ['KATES', 'DBQ'],
          base: '300',
          top: '390',
          atHours: 3,
        },
        {
          feed: 'gairmet',
          hazard: 'ICE',
          tag: '4E',
          severity: 'MOD',
          dueTo: null,
          over: ['HARTY', 'NWTON'],
          base: '120',
          top: '220',
          atHours: 6,
        },
      ],
    },
  }),
  defineCase({
    id: 'ksfo-kjfk-us-feeds-down',
    plan: 'ksfo-kjfk-b739-lbs',
    title: 'The US hazard feeds are down; strong gusts at JFK',
    tags: ['degraded', 'partial hazard feeds', 'gusts'],
    expect:
      'Says US SIGMETs and G-AIRMETs could not be read, so hazards may be missing; enrouteHazards ' +
      'empty. KJFK wind 310 at 25 gusting 38 kt. KSFO LIFR. Risk moderate.',
    weather: { destination: { metar: '31025G38KT 10SM FEW040 BKN060 10/M02 A2985' } },
    hazards: { advisories: [], unavailableFeeds: ['airsigmet', 'gairmet'] },
  }),
];

/**
 * EGLL → KJFK, A330-900, alternate KPHL, across the North Atlantic. Dispatch: all VFR. Briefed
 * at 1845Z on 11 Nov, arrival about 0235Z on 12 Nov.
 */
export const egllKjfk = [
  defineCase({
    id: 'egll-kjfk-oceanic-turbulence',
    plan: 'egll-kjfk-a339-kgs',
    title: 'Severe turbulence over the North Atlantic at cruise level',
    tags: ['hazard', 'turbulence', 'severe', 'oceanic'],
    expect:
      'Names the severe turbulence SIGMET on 54N020W → 51N050W, FL340 to FL410. All ' +
      'airports VFR. Risk high (severe hazard).',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['CZQX', 'CZQX GANDER OCEANIC'],
          seriesId: 'B2',
          hazard: 'TURB',
          qualifier: 'SEV',
          over: ['54N030W', '53N040W'],
          marginDeg: 1,
          baseFt: 34000,
          topFt: 41000,
          validHours: [0, 6],
          text: 'SEV TURB FCST FL340/410 MOV E 25KT NC',
        },
      ],
    },
  }),
  defineCase({
    id: 'egll-kjfk-alternate-fog',
    plan: 'egll-kjfk-a339-kgs',
    title: 'Philadelphia (alternate) LIFR in fog; rain and low cloud at JFK around arrival',
    tags: ['airport', 'alternate', 'LIFR', 'TAF at arrival'],
    expect:
      'KPHL LIFR in fog (1/4 SM, vertical visibility 200 ft), changed since dispatch. KJFK VFR ' +
      'now, but the TAF brings light rain, mist and overcast 1,200 ft from 0000Z on 12 Nov, ' +
      'before the 0235Z arrival. Risk high (alternate LIFR).',
    weather: {
      destination: {
        taf: '{0}/{24} 21008KT P6SM SCT250 FM{+6}00 18006KT 4SM -RA BR OVC012 FM{+12}00 20008KT P6SM BKN040',
      },
      alternate: {
        metar: '00000KT 1/4SM FG VV002 12/12 A2990',
        taf: '{0}/{24} VRB03KT 1/4SM FG VV002 FM{+9}00 22006KT 3SM BR OVC008 FM{+14}00 24008KT P6SM BKN030',
      },
    },
    hazards: NO_HAZARDS,
  }),
  defineCase({
    id: 'egll-kjfk-quiet',
    plan: 'egll-kjfk-a339-kgs',
    title: 'Quiet crossing: weather as at dispatch, nothing on the route',
    tags: ['quiet', 'overnight'],
    expect:
      'All three airports VFR, no hazards. Risk low. Times on 12 Nov carry the day. Nothing ' +
      'added that the reports do not say.',
    weather: {},
    hazards: NO_HAZARDS,
  }),
];

/** RJTT → VHHH, A330-900, no alternate. Dispatch: both VFR. Arrival about 2345Z. */
export const rjttVhhh = [
  defineCase({
    id: 'rjtt-vhhh-typhoon',
    plan: 'rjtt-vhhh-a339-noalt',
    title: 'Tropical cyclone over Taiwan on the route; gusty at Hong Kong',
    tags: ['hazard', 'tropical cyclone'],
    expect:
      'Names tropical cyclone NOVA on PIDGY → KADLO, up to FL450. VHHH wind 070 at 18 ' +
      'gusting 28 kt, TEMPO showers and gusts to 38 kt around arrival. Risk high (tropical ' +
      'cyclone).',
    weather: {
      destination: {
        metar: '07018G28KT 9999 FEW020 SCT035 23/18 Q1012',
        taf: '{0}/{24} 07015G25KT 9999 FEW020 SCT035 TEMPO {+4}/{+8} 08025G38KT 4000 SHRA BKN012',
      },
    },
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['RCAA', 'RCAA TAIPEI FIR'],
          seriesId: 'C1',
          hazard: 'TC',
          qualifier: 'NOVA',
          over: ['HLG', 'HOMEI', 'WUCHI', 'SWORD', 'MKG'],
          baseFt: null,
          topFt: 45000,
          validHours: [-1, 6],
          text: 'TC NOVA PSN N2400 E12030 CB OBS WI 150NM OF CENTRE TOP FL450 MOV NNW 10KT NC',
        },
      ],
    },
  }),
  defineCase({
    id: 'rjtt-vhhh-volcanic-ash',
    plan: 'rjtt-vhhh-a339-noalt',
    title: 'Volcanic ash south of Kyushu across the route',
    tags: ['hazard', 'volcanic ash'],
    expect:
      'Names the volcanic ash SIGMET (Suwanosejima) on SUC → AKVAS, 15,000 ft to FL400. ' +
      'Both airports VFR. Risk high (volcanic ash).',
    weather: {},
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['RJJJ', 'RJJJ FUKUOKA FIR'],
          seriesId: 'V1',
          hazard: 'VA',
          qualifier: 'SUWANOSEJIMA',
          over: ['KOSHI', 'JEDAI', 'RUSAR'],
          baseFt: 15000,
          topFt: 40000,
          text: 'VA ERUPTION MT SUWANOSEJIMA PSN N2938 E12943 VA CLD OBS FL150/400 MOV SW 20KT',
        },
      ],
    },
  }),
  defineCase({
    id: 'rjtt-vhhh-arrival-thunderstorms',
    plan: 'rjtt-vhhh-a339-noalt',
    title: 'Thunderstorms at Hong Kong now and in the TAF, embedded TS on the approach route',
    tags: ['hazard', 'thunderstorm', 'TAF at arrival', 'worse since dispatch'],
    expect:
      'Names the embedded thunderstorm SIGMET on KADLO → FISHA, up to FL450. VHHH ' +
      'thunderstorm with rain now (MVFR, changed since dispatch), TEMPO 3,000 m in TSRA with CB ' +
      'around arrival. Risk moderate.',
    weather: {
      destination: {
        metar: '09012KT 6000 TSRA FEW015CB BKN030 24/22 Q1010',
        taf: '{0}/{24} 09010KT 8000 FEW015CB SCT030 TEMPO {+3}/{+7} 3000 TSRA BKN012CB',
      },
    },
    hazards: {
      advisories: [
        {
          feed: 'isigmet',
          fir: ['VHHK', 'VHHK HONG KONG FIR'],
          seriesId: 'S2',
          hazard: 'TS',
          qualifier: 'EMBD',
          over: ['ANPOG', 'ELATO', 'MAGOG'],
          baseFt: null,
          topFt: 45000,
          validHours: [-1, 6],
          text: 'EMBD TS OBS TOP FL450 MOV W 10KT INTSF',
        },
      ],
    },
  }),
];
