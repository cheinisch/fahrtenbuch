export const themes = {
  // An die Cloudflare-Webseite angelehnte, warme und kontrastreiche Farbwelt.
  light: {
    main: '#ffffff',
    text: '#1d1d1d',
    accent: '#f48120',
    accentSecondary: '#e86f00',
    accentText: '#1d1d1d',
    surface: '#f7f7f5',
    border: '#dededb',
    mutedText: '#666666',
    accentSoft: '#fff0e2',
    danger: '#b42318',
  },
  dark: {
    main: '#1d1d1d',
    text: '#f7f7f5',
    accent: '#f48120',
    accentSecondary: '#ffad42',
    accentText: '#1d1d1d',
    surface: '#121212',
    border: '#3a3a3a',
    mutedText: '#a8a8a8',
    accentSoft: '#3a2416',
    danger: '#ff7b72',
  },
};

export const themeOptions = ['light', 'dark', 'system'];
export const defaultThemeMode = 'system';

export const theme = {
  colors: themes.light,
  radius: {
    card: '1rem',
    control: '0.75rem',
  },
};

export function resolveThemeMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode = defaultThemeMode) {
  const resolvedMode = resolveThemeMode(mode);
  const colors = themes[resolvedMode];
  const root = document.documentElement;

  root.dataset.theme = resolvedMode;
  root.dataset.themePreference = mode;
  root.style.colorScheme = resolvedMode;

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(
      `--color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
      value,
    );
  }

  root.style.setProperty('--radius-card', theme.radius.card);
  root.style.setProperty('--radius-control', theme.radius.control);
  return resolvedMode;
}

export function getStoredThemeMode() {
  const stored = localStorage.getItem('fahrtenbuch_theme');
  return themeOptions.includes(stored) ? stored : defaultThemeMode;
}

export function saveThemeMode(mode) {
  localStorage.setItem('fahrtenbuch_theme', mode);
  return applyTheme(mode);
}
