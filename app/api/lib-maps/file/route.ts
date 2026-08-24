import { currentSession } from "@/lib/server/access";
import { readPrivateLIBFile } from "@/lib/server/githubLibs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path")?.trim();

  if (!path) {
    return new Response("Missing LIB path.", { status: 400 });
  }

  try {
    const text = await readPrivateLIBFile(path);
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Parade Suite] Private GitHub LIB file error", error);
    return new Response(
      error instanceof Error ? error.message : "Unable to read LIB file.",
      { status: 500 }
    );
  }
}
