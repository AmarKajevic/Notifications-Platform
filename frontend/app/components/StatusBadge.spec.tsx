import { render, screen } from '@testing-library/react';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders a human-readable label for each status', () => {
    render(<StatusBadge status="DELIVERED" />);
    expect(screen.getByText('Delivered')).toBeTruthy();
  });

  it('derives the badge class from the status', () => {
    const { container } = render(<StatusBadge status="RETRYING" />);
    expect(container.querySelector('.badge-retrying')).toBeTruthy();
  });
});
