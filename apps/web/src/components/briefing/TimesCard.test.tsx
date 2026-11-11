import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixturePlan } from '../../test/plans';
import { TimesCard } from './TimesCard';

// EDDB → EDDM: Out 14:00Z (15:00L), Off 14:10Z, On 14:59:31Z (shown 15:00Z), both UTC+1.
const plan = fixturePlan('eddb-eddm-c750-kgs');

const card = () => screen.getByRole('region', { name: 'Times' });

describe('<TimesCard /> countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down to pushback every second, in amber under ten minutes', () => {
    vi.setSystemTime(new Date('2026-11-09T13:49:58Z'));
    render(<TimesCard plan={plan} />);

    const timer = within(card()).getByRole('timer', { name: 'Pushback in' });
    expect(timer).toHaveTextContent('10:02');
    expect(within(card()).getByText(/^at /)).toHaveTextContent('at 14:00Z · 15:00L');
    expect(timer.closest('div.rounded-lg')).not.toHaveClass('bg-amber-50');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(timer).toHaveTextContent('9:59');
    expect(timer.closest('div.rounded-lg')).toHaveClass('bg-amber-50');
  });

  it('moves on to takeoff at Out and says how long ago pushback was planned', () => {
    vi.setSystemTime(new Date('2026-11-09T13:59:59Z'));
    render(<TimesCard plan={plan} />);
    expect(screen.getByRole('timer', { name: 'Pushback in' })).toHaveTextContent('0:01');

    act(() => {
      vi.advanceTimersByTime(3 * 60_000 + 13_000);
    });
    expect(screen.getByRole('timer', { name: 'Takeoff in' })).toHaveTextContent('6:48');
    expect(screen.getByText(/^at /)).toHaveTextContent(
      'at 14:10Z · 15:10L · planned pushback was 3:12 ago',
    );
  });

  it('counts down to landing once airborne, at destination local time', () => {
    vi.setSystemTime(new Date('2026-11-09T14:52:00Z'));
    render(<TimesCard plan={plan} />);
    expect(screen.getByRole('timer', { name: 'Landing in' })).toHaveTextContent('8:00');
    expect(screen.getByText(/^at /)).toHaveTextContent('at 15:00Z · 16:00L');
  });

  it('shows no countdown for a plan already flown or more than a day ahead', () => {
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
    const { unmount } = render(<TimesCard plan={plan} />);
    expect(screen.queryByRole('timer')).toBeNull();
    unmount();

    vi.setSystemTime(new Date('2026-11-07T09:00:00Z'));
    render(<TimesCard plan={plan} />);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(within(card()).getByText('Out', { selector: 'dt' })).toBeInTheDocument();
  });
});
