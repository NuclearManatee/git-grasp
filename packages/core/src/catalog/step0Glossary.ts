/** Minimal glossary stub for eval judge placeholder materialization. */
export const DEFAULT_GLOSSARY = Object.freeze({
  branch: 'main',
  remote: 'origin',
  message: 'update',
  file: 'app.js',
});

/**
 * Replace <placeholders> using glossary map.
 */
export function materializePlaceholders(text, glossary = DEFAULT_GLOSSARY) {
  return String(text || '').replace(/<([a-zA-Z0-9_-]+)>/g, (_, key) => {
    return glossary[key] != null ? String(glossary[key]) : `<${key}>`;
  });
}
