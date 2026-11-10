import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixturePlan } from '../../test/plans';
import { WeatherCard } from './WeatherCard';

describe('<WeatherCard />', () => {
  it('shows METAR and TAF for departure, destination and alternate', () => {
    render(<WeatherCard plan={fixturePlan('eddb-eddm-c750-kgs')} />);

    const departure = screen.getByRole('region', { name: 'Departure weather' });
    expect(departure).toHaveTextContent('Departure EDDB');
    expect(within(departure).getByText(/^EDDB 091320Z AUTO 10005KT/)).toBeInTheDocument();

    const destination = screen.getByRole('region', { name: 'Destination weather' });
    // TAF change groups keep their line breaks.
    const taf = within(destination).getByText(/^EDDM 091100Z 0912\/1018/);
    expect(taf.tagName).toBe('PRE');
    expect(taf.textContent).toContain('\nBECMG 0912/0914 SCT005\n');

    expect(screen.getByRole('region', { name: 'Alternate weather' })).toHaveTextContent(
      'Alternate EDDF',
    );
  });

  it('leaves the alternate out when the plan has none', () => {
    render(<WeatherCard plan={fixturePlan('eddf-lepa-a339-noalt')} />);

    expect(screen.getByRole('region', { name: 'Departure weather' })).toHaveTextContent('EDDF');
    expect(screen.getByRole('region', { name: 'Destination weather' })).toHaveTextContent('LEPA');
    expect(screen.queryByRole('region', { name: 'Alternate weather' })).not.toBeInTheDocument();
  });

  it('says so when a report is missing from the OFP', () => {
    const plan = fixturePlan('eddb-eddm-c750-kgs');
    plan.origin = { ...plan.origin, metar: null };
    render(<WeatherCard plan={plan} />);

    const departure = screen.getByRole('region', { name: 'Departure weather' });
    expect(within(departure).getByText('Not in the OFP')).toBeInTheDocument();
  });
});
