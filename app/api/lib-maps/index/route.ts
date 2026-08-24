import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/access";
import { listPrivateLIBFiles } from "@/lib/server/githubLibs";

export const dynamic = "force-dynamic";

function normalizeTrackName(text: string): string {
  const basename = text.replace(/^.*[\\/]/, "");
  const stem = basename.replace(/\.[^.]+$/, "");
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function GET() {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await listPrivateLIBFiles();
    const index: Record<string, string> = {};

    for (const file of files) {
      const key = normalizeTrackName(file.name);
      if (key) index[key] = file.path;
    }

    return NextResponse.json(index, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Parade Suite] Private GitHub LIB index error", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to read the private GitHub LIB repository.",
      },
      { status: 500 }
    );
  }
}
