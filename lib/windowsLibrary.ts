import { normalizeTrackName } from "./timing";

export type WindowsLibraryRecord = {
  title: string;
  path: string;
  category: string;
  allow_continue: boolean;
  allow_repeat: boolean;
  allow_end: boolean;
};

let libraryCache: WindowsLibraryRecord[] | null = null;
let correctionsCache: Record<string, string> | null = null;

export async function loadWindowsLibraryReference() {
  if (!libraryCache) {
    try {
      const response = await fetch("/windows_reference/music_library.json", {
        cache: "force-cache",
      });
      libraryCache = response.ok ? await response.json() : [];
    } catch {
      libraryCache = [];
    }
  }

  if (!correctionsCache) {
    try {
      const response = await fetch(
        "/windows_reference/category_corrections.json",
        { cache: "force-cache" }
      );
      correctionsCache = response.ok ? await response.json() : {};
    } catch {
      correctionsCache = {};
    }
  }

  return {
    library: libraryCache ?? [],
    corrections: correctionsCache ?? {},
  };
}

export async function windowsMetadataForFile(fileName: string) {
  const { library, corrections } = await loadWindowsLibraryReference();
  const key = normalizeTrackName(fileName);

  // Same precedence as Windows infer_category:
  // user category correction first.
  const correctedCategory = corrections[key];

  const exact = library.find((record) => {
    const sourceName = record.path.replace(/^.*[\\/]/, "");
    return (
      normalizeTrackName(sourceName) === key ||
      normalizeTrackName(record.title) === key
    );
  });

  return {
    record: exact ?? null,
    category: correctedCategory || exact?.category || null,
  };
}
