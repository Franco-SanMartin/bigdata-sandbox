/* IBM Plex dentro del bundle (solo latin): la app tiene que verse igual sin internet. */
import sans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2';
import sans500 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2';
import sans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2';
import mono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2';
import mono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2';

export function loadFonts() {
  const faces: [string, string, string][] = [
    ['IBM Plex Sans', sans400, '400'], ['IBM Plex Sans', sans500, '500'], ['IBM Plex Sans', sans600, '600'],
    ['IBM Plex Mono', mono400, '400'], ['IBM Plex Mono', mono500, '500'],
  ];
  return Promise.all(faces.map(([family, url, weight]) => {
    const f = new FontFace(family, `url(${url}) format("woff2")`, { weight, display: 'swap' });
    document.fonts.add(f);
    return f.load().catch(() => undefined);
  }));
}
