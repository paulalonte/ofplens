import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../test/plans';
import { NavlogCard } from './NavlogCard';

/** The cells of the navlog row whose fix ident is `ident`, as text. */
function cells(ident: string): string[] {
  const row = screen.getByRole('rowheader', { name: new RegExp(`^${ident}\\b`) }).closest('tr');
  if (!row) throw new Error(`no row for ${ident}`);
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1); // drop the header row
}

describe('<NavlogCard /> with the EDDB → EDDM plan', () => {
  it('lists every fix, from the first SID waypoint to the destination', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    const rows = bodyRows();
    expect(rows).toHaveLength(19);
    expect(rows[0]).toHaveTextContent(/^DB068/);
    expect(rows.at(-1)).toHaveTextContent(/^EDDM/);
  });

  it('shows via, stage, altitude, wind, OAT, ETA, fuel on board, elapsed time and fuel used', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    // Off 14:10Z + 00:04:05 elapsed = 14:14:05Z. Used = takeoff 2,364 - FOB 2,236 = 128,
    // SimBrief's own fuel_totalused for this fix.
    expect(cells('DB069')).toEqual([
      'LURO4B',
      'CLB',
      '13,600',
      '209/18',
      '-16°',
      '14:14Z',
      '2,236',
      '00:04',
      '128',
    ]);
    expect(screen.getByRole('columnheader', { name: 'FOB (kg)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ET' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Used (kg)' })).toBeInTheDocument();
  });

  it('ends at the destination with the air time and the planned trip fuel', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    // Air time 00:49:31, trip fuel 992 kg.
    expect(cells('EDDM').slice(-2)).toEqual(['00:50', '992']);
  });

  it('prints the route string and a summary line', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    expect(screen.getByText(/^EDDB LURO4B LUROS Y211/)).toHaveTextContent(/LAND2A EDDM$/);
    expect(screen.getByText('333 nm · FL280 · CI 10')).toBeInTheDocument();
  });

  it('shows fuel on board and fuel used in the selected display unit', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="lbs" />);

    expect(screen.getByRole('columnheader', { name: 'FOB (lb)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Used (lb)' })).toBeInTheDocument();
    // 2,236 kg and 128 kg in pounds.
    expect(cells('DB069').slice(-3)).toEqual(['4,930', '00:04', '282']);
  });
});

describe('<NavlogCard /> with the KSFO → KJFK plan', () => {
  it('names top of climb and top of descent', () => {
    render(<NavlogCard plan={fixturePlan('ksfo-kjfk-b739-lbs')} displayUnit="lbs" />);

    expect(bodyRows()).toHaveLength(30);
    expect(screen.getByRole('rowheader', { name: 'TOC TOP OF CLIMB' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'TOD TOP OF DESCENT' })).toBeInTheDocument();
    // Off 01:20Z + 00:24:18 elapsed = 01:44:18Z.
    expect(cells('TOC')).toEqual(expect.arrayContaining(['CLB', '35,000', '01:44Z']));
    // 24 minutes after takeoff, 4,643 lb burned (takeoff 35,108 - FOB 30,465).
    expect(cells('TOC').slice(-2)).toEqual(['00:24', '4,643']);
  });
});
