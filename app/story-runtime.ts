export type RuntimeMinutes = 3 | 7;

export type RuntimeProfile = {
  minutes: RuntimeMinutes;
  label: string;
  shortLabel: string;
  minWords: number;
  maxWords: number | null;
  targetWords: string;
  defaultMusicCues: number;
};

const RUNTIME_PROFILES: Record<RuntimeMinutes, RuntimeProfile> = {
  3: {
    minutes: 3,
    label: "3-minute demo",
    shortLabel: "3 minutes",
    minWords: 420,
    maxWords: 470,
    targetWords: "430–450",
    defaultMusicCues: 4,
  },
  7: {
    minutes: 7,
    label: "7+ minute episode",
    shortLabel: "7+ minutes",
    minWords: 1050,
    maxWords: null,
    targetWords: "1,100–1,250",
    defaultMusicCues: 7,
  },
};

export function normalizeRuntimeMinutes(value: unknown): RuntimeMinutes {
  return Number(value) === 7 ? 7 : 3;
}

export function runtimeProfile(value: unknown): RuntimeProfile {
  return RUNTIME_PROFILES[normalizeRuntimeMinutes(value)];
}

export function runtimeWordIssue(wordCount: number, value: unknown) {
  const profile = runtimeProfile(value);
  if (wordCount < profile.minWords) {
    return `only ${wordCount} spoken words; ${profile.label} requires at least ${profile.minWords}`;
  }
  if (profile.maxWords !== null && wordCount > profile.maxWords) {
    return `${wordCount} spoken words; ${profile.label} must stay at or below ${profile.maxWords}`;
  }
  return "";
}
