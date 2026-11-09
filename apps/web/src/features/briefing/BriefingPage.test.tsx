import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fixturePlan as plan } from '../../test/plans';
import { BriefingPage } from './BriefingPage';

/** The value shown next to a label inside a named card. */
function value(card: string, label: string): string {
  const region = screen.getByRole('region', { name: card });
  const term = within(region).getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

describe('<BriefingPage /> with the EDDB → EDDM bizjet plan (kg)', () => {
  it('shows the header: callsign, date, AIRAC, route, alternate and aircraft', () => {
    render(<BriefingPage plan={plan('eddb-eddm-c750-kgs')} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('N70P');
    expect(screen.getByText(/09 NOV 2026/)).toHaveTextContent('09 NOV 2026 · AIRAC 2611');
    const route = screen.getByLabelText('Route');
    expect(route).toHaveTextContent('EDDB');
    expect(route).toHaveTextContent('BERLIN BRANDENBURG · RWY 06L');
    expect(route).toHaveTextContent('EDDM');
    expect(route).toHaveTextContent('Alternate EDDF');
    expect(screen.getByText(/CITATION X/)).toHaveTextContent('C750 · CITATION X · N750SB');
  });

  it('shows Zulu and local times, block and air time, rounded consistently', () => {
    render(<BriefingPage plan={plan('eddb-eddm-c750-kgs')} />);

    expect(value('Times', 'Out')).toBe('14:00Z15:00L');
    expect(value('Times', 'In')).toBe('15:08Z16:08L');
    expect(value('Times', 'Block time')).toBe('01:08');
    expect(value('Times', 'Air time')).toBe('00:50');
    expect(screen.getByText(/^Local:/)).toHaveTextContent('Local: EDDB UTC+1, EDDM UTC+1');
  });

  it('shows fuel and payload in kg by default', () => {
    render(<BriefingPage plan={plan('eddb-eddm-c750-kgs')} />);

    expect(screen.getByRole('button', { name: 'kg' })).toHaveAttribute('aria-pressed', 'true');
    expect(value('Fuel', 'Trip')).toBe('992 kg');
    expect(value('Fuel', 'Alternate (EDDF)')).toBe('767 kg');
    expect(value('Fuel', 'Block fuel')).toBe('2,432 kg');
    expect(value('Fuel', 'Planned landing')).toBe('1,372 kg');
    expect(value('Payload', 'Passengers')).toBe('8');
    expect(value('Payload', 'Zero fuel weight')).toBe('10,873 kg');
  });

  it('converts every weight when switched to lb, and back', async () => {
    const user = userEvent.setup();
    render(<BriefingPage plan={plan('eddb-eddm-c750-kgs')} />);

    await user.click(screen.getByRole('button', { name: 'lb' }));

    expect(screen.getByRole('button', { name: 'lb' })).toHaveAttribute('aria-pressed', 'true');
    expect(value('Fuel', 'Trip')).toBe('2,187 lb');
    expect(value('Fuel', 'Block fuel')).toBe('5,362 lb');
    expect(value('Payload', 'Zero fuel weight')).toBe('23,971 lb');
    expect(value('Payload', 'Passengers')).toBe('8');
    const cards = ['Fuel', 'Payload'].map((name) => screen.getByRole('region', { name }));
    for (const card of cards) expect(card).not.toHaveTextContent(/\bkg\b/);
    expect(screen.getByText(/converted for display/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'kg' }));
    expect(value('Fuel', 'Block fuel')).toBe('2,432 kg');
  });
});

describe('<BriefingPage /> with the KSFO → KJFK plan (lbs, crosses midnight UTC)', () => {
  it('starts in lb and marks the departure as the previous local day', () => {
    render(<BriefingPage plan={plan('ksfo-kjfk-b739-lbs')} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UAL1234');
    expect(screen.getByRole('button', { name: 'lb' })).toHaveAttribute('aria-pressed', 'true');
    expect(value('Fuel', 'Block fuel')).toBe('35,608 lb');

    expect(value('Times', 'Out')).toBe('01:00Z17:00L−1');
    expect(value('Times', 'Off')).toBe('01:20Z17:20L−1');
    // Out and Off fall on the previous local day in San Francisco; On and In do not.
    expect(screen.getAllByTitle('Previous day local')).toHaveLength(2);
    expect(value('Times', 'In')).toBe('06:18Z01:18L');
    expect(value('Times', 'Block time')).toBe('05:18');
  });

  it('converts to kg on request', async () => {
    const user = userEvent.setup();
    render(<BriefingPage plan={plan('ksfo-kjfk-b739-lbs')} />);

    await user.click(screen.getByRole('button', { name: 'kg' }));

    expect(value('Fuel', 'Block fuel')).toBe('16,152 kg');
    expect(value('Payload', 'Zero fuel weight')).toBe('61,235 kg');
  });
});

describe('<BriefingPage /> with the EDDF → LEPA plan (no alternate)', () => {
  it('says there is no alternate instead of showing empty fuel', () => {
    render(<BriefingPage plan={plan('eddf-lepa-a339-noalt')} />);

    expect(screen.getByLabelText('Route')).toHaveTextContent('No alternate');
    expect(value('Fuel', 'Alternate')).toBe('—');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('DLH814');
  });
});
