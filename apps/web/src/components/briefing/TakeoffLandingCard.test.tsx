import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../test/plans';
import { TakeoffLandingCard } from './TakeoffLandingCard';

/** The rows of one phase as { label: value }. */
function rows(name: 'Takeoff runway' | 'Landing runway'): Record<string, string> {
  const section = screen.getByRole('region', { name });
  return Object.fromEntries(
    within(section)
      .getAllByRole('term')
      .map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']),
  );
}

describe('<TakeoffLandingCard />', () => {
  it('shows KSFO 01R and KJFK 31R as SimBrief planned them', () => {
    render(<TakeoffLandingCard plan={fixturePlan('ksfo-kjfk-b739-lbs')} displayUnit="lbs" />);

    const card = screen.getByRole('region', { name: 'Takeoff & landing' });
    expect(card).toHaveTextContent('SimBrief planning at dispatch');

    const takeoff = screen.getByRole('region', { name: 'Takeoff runway' });
    expect(within(takeoff).getByRole('heading')).toHaveTextContent('Takeoff KSFO 01R');
    expect(within(takeoff).getByText('wet')).toBeInTheDocument();
    expect(rows('Takeoff runway')).toEqual({
      Wind: '306° / 12 kt',
      Headwind: '4 kt',
      Crosswind: '11 kt from the left',
      Temperature: '14°C',
      QNH: '1020 hPa · 30.13 inHg',
      Runway: 'TORA 8,650 ft · course 014°',
      'Flaps · thrust': 'Flaps 5 · TO',
      'V1 / VR / V2': '146 / 154 / 162 kt',
      'Takeoff weight': '170,109 lb',
    });

    expect(rows('Landing runway')).toEqual({
      Wind: '303° / 12 kt',
      Headwind: '12 kt',
      Crosswind: '2 kt from the left',
      Temperature: '14°C',
      QNH: '1009 hPa · 29.81 inHg',
      Runway: 'LDA 8,486 ft · course 314°',
      ILS: '111.50',
      Flaps: '30',
      VREF: '142 kt',
      'Landing distance': '4,357 ft (factored, dry)',
      'Landing weight': '142,250 lb',
    });
  });

  it('shows a tailwind, FLEX thrust and weights in the selected unit', () => {
    render(<TakeoffLandingCard plan={fixturePlan('eddf-lepa-a339-noalt')} displayUnit="kgs" />);

    expect(rows('Takeoff runway')).toMatchObject({
      Tailwind: '5 kt',
      'Flaps · thrust': 'Flaps 1 · FLEX 53°C',
      'Takeoff weight': '181,431 kg',
    });
    expect(rows('Landing runway')).toMatchObject({
      Crosswind: 'None',
      'Landing distance': '5,729 ft (factored, wet)',
    });
  });

  it('is left out when the OFP has no takeoff or landing data', () => {
    const { container } = render(
      <TakeoffLandingCard
        plan={{ ...fixturePlan('eddb-eddm-c750-kgs'), performance: null }}
        displayUnit="kgs"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
