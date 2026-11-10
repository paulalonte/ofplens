import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../test/plans';
import { FlightDataCard } from './FlightDataCard';

/** Each label's value and note, as text: { 'Cost index': '16', ... }. */
function items(): Record<string, string> {
  return Object.fromEntries(
    screen.getAllByRole('term').map((dt) => {
      const values = [];
      for (let el = dt.nextElementSibling; el?.tagName === 'DD'; el = el.nextElementSibling) {
        values.push(el.textContent ?? '');
      }
      return [dt.textContent ?? '', values.join(' | ')];
    }),
  );
}

describe('<FlightDataCard />', () => {
  it('shows the KSFO → KJFK flight data, with the step climb and a tailwind', () => {
    render(<FlightDataCard plan={fixturePlan('ksfo-kjfk-b739-lbs')} />);

    expect(screen.getByRole('region', { name: 'Flight data' })).toBeInTheDocument();
    // Column by column: cruise, then distances, then airports and wind.
    expect(Object.keys(items())).toEqual([
      'Cruise altitude',
      'Cruise temperature',
      'Tropopause',
      'Cost index',
      'G/C distance',
      'Route distance',
      'Origin elevation',
      'Destination elevation',
      'Wind component',
    ]);
    expect(items()).toEqual({
      'Cost index': '16',
      'Cruise altitude': 'FL350 | Step to FL370 at DBQ',
      'Cruise temperature': '-53°C | At top of climb · avg ISA +1',
      Tropopause: 'FL414 | Route average',
      'Wind component': '61 kt tailwind | Route average',
      'Origin elevation': '13 ft | KSFO',
      'Destination elevation': '13 ft | KJFK',
      'G/C distance': '2,242 nm | Great circle',
      'Route distance': '2,298 nm | Planned route',
    });
  });

  it('shows a headwind and no step climbs for EDDB → EDDM', () => {
    render(<FlightDataCard plan={fixturePlan('eddb-eddm-c750-kgs')} />);

    expect(items()).toMatchObject({
      'Cruise altitude': 'FL280 | No step climbs',
      'Cruise temperature': '-41°C | At top of climb · avg ISA +0',
      'Wind component': '6 kt headwind | Route average',
      'Destination elevation': '1,487 ft | EDDM',
      'G/C distance': '249 nm | Great circle',
    });
  });

  it('shows a dash for data the plan does not have', () => {
    const plan = fixturePlan('eddf-lepa-a339-noalt');
    render(
      <FlightDataCard
        plan={{
          ...plan,
          origin: { ...plan.origin, elevationFt: null },
          route: {
            ...plan.route,
            costIndex: null,
            gcDistanceNm: null,
            avgIsaDevC: null,
            avgTropopauseFt: null,
            avgWindComponentKt: null,
          },
        }}
      />,
    );

    expect(items()).toMatchObject({
      'Cost index': '—',
      'Cruise altitude': 'FL290 | Step to FL390 at HERBI',
      'Cruise temperature': '-41°C | At top of climb',
      Tropopause: '— | Route average',
      'Wind component': '— | Route average',
      'Origin elevation': '— | EDDF',
      'G/C distance': '— | Great circle',
    });
  });
});
