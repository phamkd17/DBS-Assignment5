// Personal tags on a followed station ("JCL", "Volleyball"). Edited as one
// comma-separated line; the limits match public.valid_tags() in Postgres.

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

// "JCL, volleyball ,, jcl" -> ["JCL", "volleyball"]
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

export function formatTags(tags: string[]): string {
  return tags.join(", ");
}
