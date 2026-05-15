export type MemoryCitationInfo = {
  citationEntries: string[];
  rolloutIds: string[];
};

const COMPLETE_STANDALONE_MEMORY_CITATION_PATTERN =
  /(^|\n)[ \t]*(?:`+\s*)?<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>(?:\s*`+)?[ \t]*(?=\n|$)/gi;

const UNFINISHED_STANDALONE_MEMORY_CITATION_PATTERN =
  /(^|\n)[ \t]*(?:`+\s*)?<oai-mem-citation>[\s\S]*$/i;

function extractMemoryCitationSection(value: string, tag: string) {
  const match = value.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  if (!match) {
    return [];
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractMemoryCitationInfo(value: string): MemoryCitationInfo | null {
  const matches = Array.from(value.matchAll(COMPLETE_STANDALONE_MEMORY_CITATION_PATTERN));
  if (matches.length === 0) {
    return null;
  }
  const citationEntries = new Set<string>();
  const rolloutIds = new Set<string>();
  matches.forEach((match) => {
    extractMemoryCitationSection(match[0], "citation_entries").forEach((entry) =>
      citationEntries.add(entry),
    );
    extractMemoryCitationSection(match[0], "rollout_ids").forEach((id) =>
      rolloutIds.add(id),
    );
  });
  return {
    citationEntries: Array.from(citationEntries),
    rolloutIds: Array.from(rolloutIds),
  };
}

export function stripStandaloneMemoryCitationBlocks(value: string) {
  return value
    .replace(COMPLETE_STANDALONE_MEMORY_CITATION_PATTERN, (match) =>
      match.startsWith("\n") ? "\n" : "",
    )
    .replace(UNFINISHED_STANDALONE_MEMORY_CITATION_PATTERN, (match) =>
      match.startsWith("\n") ? "\n" : "",
    );
}
