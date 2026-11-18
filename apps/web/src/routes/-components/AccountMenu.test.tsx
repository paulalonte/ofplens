import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, TEST_SESSION } from '../../test/mockApi';
import { jsonResponse } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { initials } from './AccountMenu';

const noPlans = () => jsonResponse({ items: [], nextCursor: null });
const PICTURE = 'https://avatars.example.com/u/1.png';

async function renderWith(avatarUrl: string | null) {
  mockApi({
    'GET /api/auth/session': () =>
      jsonResponse({ ...TEST_SESSION, pilot: { ...TEST_SESSION.pilot, avatarUrl } }),
    'GET /api/flight-plans': noPlans,
  });
  await renderApp('/history');
  const header = screen.getByRole('banner');
  return { header, account: within(header).getByRole('button', { name: 'Account: Test Pilot' }) };
}

describe('<AccountMenu />', () => {
  it("shows the provider's picture", async () => {
    const { account } = await renderWith(PICTURE);

    const img = account.querySelector('img');
    expect(img).toHaveAttribute('src', PICTURE);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('shows initials without a picture, or when it fails to load', async () => {
    const { account } = await renderWith(PICTURE);
    fireEvent.error(account.querySelector('img')!);

    expect(account.querySelector('img')).toBeNull();
    expect(account).toHaveTextContent('TP');
  });

  it('opens with the name and Sign out, and closes on Escape and outside clicks', async () => {
    const user = userEvent.setup();
    const { header, account } = await renderWith(null);
    expect(within(header).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();

    await user.click(account);
    expect(within(header).getByText('Test Pilot')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();

    await user.click(account);
    await user.click(screen.getByRole('main'));
    expect(within(header).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});

describe('initials', () => {
  it.each([
    ['Test Pilot', 'TP'],
    ['travelRound', 'TR'],
    ['ana', 'AN'],
    ['ana.lopez@example.com', 'AL'],
    ['  ', '?'],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
