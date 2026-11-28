// Sample headlines for the "Speak mode" demo (AllAges.astro).
// Benign topics only: weather, events, sports. Never fires, crashes or crimes.
// Every line is public copy: changes need wording approval in review.
export interface SpeakSample {
  topic: 'Weather' | 'Events' | 'Sports';
  standard: string;
  brainrot: string;
}

export const speakSamples: SpeakSample[] = [
  {
    topic: 'Weather',
    standard: 'Sunny and mild across the city this afternoon.',
    brainrot: 'Sky is lowkey flawless this afternoon, no cap.',
  },
  {
    topic: 'Weather',
    standard: 'Light snow expected overnight. Allow extra time in the morning.',
    brainrot: 'Snow pulling up overnight. Morning you needs a head start, fr.',
  },
  {
    topic: 'Events',
    standard: 'The farmers market opens downtown on Saturday at 9 a.m.',
    brainrot: 'Farmers market drops downtown Saturday at 9 a.m. The snack aura is immense.',
  },
  {
    topic: 'Events',
    standard: 'Free outdoor concert in the park Friday evening.',
    brainrot: 'Free park concert Friday evening. Main character soundtrack unlocked.',
  },
  {
    topic: 'Sports',
    standard: 'The home team won tonight in overtime.',
    brainrot: 'Home team took the W in overtime. Absolute cinema.',
  },
];
