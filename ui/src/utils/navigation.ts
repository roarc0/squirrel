import React from 'react';

export function handleLinkClick(
  e: React.MouseEvent<HTMLElement>,
  href: string,
  onNavigate?: (tab: string) => void
) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
    return;
  }
  e.preventDefault();
  const tab = href.replace(/^\/+/, '').split('/')[0] || 'overview';
  if (onNavigate) {
    onNavigate(tab);
  }
}
