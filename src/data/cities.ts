// The one list of Wire Local cities. CityRoster and StatStrip both render
// from it, so adding a city is one new line in `cities` below.
//
// A live city must have an href: its card links there and its call to action
// reads "Visit <host> →". A coming-soon city may leave href null.

export type CityStatus = 'live' | 'soon';

interface CityFields {
  /** Display name, e.g. 'Tri-Cities'. Must be unique. */
  name: string;
  /** Two-letter state code, e.g. 'WA'. */
  state: string;
  /** One short line shown on the city card. */
  tagline: string;
}

export type City =
  | (CityFields & { status: 'live'; href: string })
  | (CityFields & { status: 'soon'; href: string | null });

export const cities: readonly City[] = [
  { name: 'Spokane', state: 'WA', status: 'live', href: 'https://spokanewire.com', tagline: 'The original wire.' },
  { name: 'Boise', state: 'ID', status: 'soon', href: null, tagline: 'Coming next.' },
  { name: 'Tacoma', state: 'WA', status: 'soon', href: null, tagline: 'On deck.' },
  { name: 'Tri-Cities', state: 'WA', status: 'soon', href: null, tagline: 'On deck.' },
];

export const statusLabel: Record<CityStatus, string> = {
  live: 'Live',
  soon: 'Coming soon',
};

/** 'https://www.spokanewire.com/x' -> 'spokanewire.com' */
export function siteHost(href: string): string {
  return new URL(href).hostname.replace(/^www\./, '');
}
