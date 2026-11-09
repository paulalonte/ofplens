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

  it('shows via, stage, altitude, wind, OAT, ETA (takeoff + elapsed) and fuel on board', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    // Off 14:10Z + 00:04:05 elapsed = 14:14:05Z.
    expect(cells('DB069')).toEqual([
      'LURO4B',
      'CLB',
      '13,600',
      '209/18',
      '-16°',
      '14:14Z',
      '2,236',
    ]);
    expect(screen.getByRole('columnheader', { name: 'FOB (kg)' })).toBeInTheDocument();
  });

  it('prints the route string and a summary line', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="kgs" />);

    expect(screen.getByText(/^EDDB LURO4B LUROS Y211/)).toHaveTextContent(/LAND2A EDDM$/);
    expect(screen.getByText('333 nm · FL280 · CI 10')).toBeInTheDocument();
  });

  it('shows fuel on board in the selected display unit', () => {
    render(<NavlogCard plan={fixturePlan('eddb-eddm-c750-kgs')} displayUnit="lbs" />);

    expect(screen.getByRole('columnheader', { name: 'FOB (lb)' })).toBeInTheDocument();
    expect(cells('DB069').at(-1)).toBe('4,930');
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
  });
});
