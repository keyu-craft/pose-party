// Vite replaces BASE_URL at build time. Resolve runtime files under the same
// project path as the app, including /repo/ on GitHub Pages.
export function publicAsset(path: string, base = import.meta.env.BASE_URL, page = document.baseURI): string {
  const root = new URL(base.endsWith('/') ? base : `${base}/`, page);
  return new URL(path.replace(/^\/+/, ''), root).href;
}
