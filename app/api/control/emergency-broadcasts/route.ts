import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isControlRequestAuthorized } from "@/lib/control-auth";

export const runtime = "nodejs";
const EVENT_CODE = "UACDC26";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment variables are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getEvent(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin.from("events").select("id").eq("event_code", EVENT_CODE).single();
  if (error || !data) throw error || new Error("UACDC26 event was not found.");
  return data;
}

async function sendPush(
  admin: ReturnType<typeof adminClient>,
  eventId: string,
  broadcast: { id: string; title: string; message: string },
  teamIds?: string[]
) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    return {
      attempted: 0,
      delivered: 0,
      failed: 0,
      configured: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require("web-push");

  webpush.setVapidDetails(
    "https://urbanadventurecivildefenceskillschallenge2026.vercel.app",
    publicKey,
    privateKey
  );

  let query = admin
    .from("push_subscriptions")
    .select("id,team_id,endpoint,p256dh,auth")
    .eq("event_id", eventId);

  if (teamIds?.length) {
    query = query.in("team_id", teamIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const stale: string[] = [];
  let attempted = 0;
  let delivered = 0;
  let failed = 0;

  await Promise.all(
    (data || []).map(async (row: any) => {
      attempted += 1;

      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth,
            },
          },
          JSON.stringify({
            title: `🚨 ${broadcast.title}`,
            body: broadcast.message,
            priority: "emergency",
            tag: `uacdc26-emergency-${broadcast.id}`,
            messageId: broadcast.id,
            url: "/team",
          })
        );

        delivered += 1;
      } catch (error: any) {
        failed += 1;

        if (
          error?.statusCode === 404 ||
          error?.statusCode === 410
        ) {
          stale.push(row.id);
        }
      }
    })
  );

  if (stale.length) {
    await admin
      .from("push_subscriptions")
      .delete()
      .in("id", stale);
  }

  return {
    attempted,
    delivered,
    failed,
    configured: true,
  };
}


async function sendGameMasterPush(admin: ReturnType<typeof adminClient>, eventId: string, broadcast: {id:string;title:string;message:string}) {
  const publicKey=process.env.VAPID_PUBLIC_KEY, privateKey=process.env.VAPID_PRIVATE_KEY;
  if(!publicKey||!privateKey)return {attempted:0,delivered:0,failed:0,configured:false};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush=require("web-push");
  webpush.setVapidDetails("https://urbanadventurecivildefenceskillschallenge2026.vercel.app",publicKey,privateKey);
  const {data,error}=await admin.from("game_master_push_subscriptions").select("id,endpoint,p256dh,auth").eq("event_id",eventId); if(error)throw error;
  const stale:string[]=[];let attempted=0,delivered=0,failed=0;
  await Promise.all((data||[]).map(async(row:any)=>{attempted++;try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({title:`🚨 ${broadcast.title}`,body:broadcast.message,priority:"emergency",tag:`uacdc26-gm-emergency-${broadcast.id}`,url:"/game-master"}));delivered++;}catch(e:any){failed++;if(e?.statusCode===404||e?.statusCode===410)stale.push(row.id);}}));
  if(stale.length)await admin.from("game_master_push_subscriptions").delete().in("id",stale);
  return {attempted,delivered,failed,configured:true};
}

export async function GET(request: NextRequest) {
  if (!isControlRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = adminClient();
    const event = await getEvent(admin);

    const [{ data: broadcasts, error }, { data: teams, error: teamError }] = await Promise.all([
      admin
        .from("emergency_broadcasts")
        .select("id,broadcast_type,title,message,is_active,created_at,ended_at")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("teams")
        .select("id,team_number,team_name")
        .eq("event_id", event.id)
        .eq("is_active", true)
        .order("team_number"),
    ]);

    if (error) throw error;
    if (teamError) throw teamError;

    const ids = (broadcasts || []).map((row: any) => row.id);
    let acknowledgements: Array<{ broadcast_id: string; team_id: string; acknowledged_at: string }> = [];

    if (ids.length) {
      const { data, error: ackError } = await admin
        .from("emergency_broadcast_acknowledgements")
        .select("broadcast_id,team_id,acknowledged_at")
        .in("broadcast_id", ids);

      if (ackError) throw ackError;
      acknowledgements = data || [];
    }

    const activeTeams = teams || [];
    const teamMap = new Map(activeTeams.map((team: any) => [team.id, team]));

    return NextResponse.json({
      activeTeams: activeTeams.length,
      broadcasts: (broadcasts || []).map((row: any) => {
        const ackRows = acknowledgements.filter((ack) => ack.broadcast_id === row.id);
        const acknowledgedTeamIds = new Set(ackRows.map((ack) => ack.team_id));
        const unacknowledgedTeams = activeTeams.filter((team: any) => !acknowledgedTeamIds.has(team.id));

        return {
          ...row,
          acknowledgementCount: ackRows.length,
          acknowledgements: ackRows
            .map((ack) => ({
              teamId: ack.team_id,
              teamNumber: teamMap.get(ack.team_id)?.team_number ?? null,
              teamName: teamMap.get(ack.team_id)?.team_name ?? "Unknown Team",
              acknowledgedAt: ack.acknowledged_at,
            }))
            .sort((a, b) => Number(a.teamNumber || 9999) - Number(b.teamNumber || 9999)),
          unacknowledgedTeams: unacknowledgedTeams.map((team: any) => ({
            teamId: team.id,
            teamNumber: team.team_number,
            teamName: team.team_name,
          })),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load emergency broadcasts." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isControlRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = adminClient();
    const event = await getEvent(admin);
    const body = await request.json();
    const action = String(body.action || "send");

    if (action === "resend-unacknowledged") {
      const broadcastId = String(body.broadcastId || "");

      if (!broadcastId) {
        return NextResponse.json(
          { error: "Broadcast ID is required." },
          { status: 400 }
        );
      }

      const { data: broadcast, error: broadcastError } = await admin
        .from("emergency_broadcasts")
        .select("id,title,message,is_active")
        .eq("id", broadcastId)
        .eq("event_id", event.id)
        .eq("is_active", true)
        .maybeSingle();

      if (broadcastError) throw broadcastError;

      if (!broadcast) {
        return NextResponse.json(
          { error: "This Emergency Broadcast is no longer active." },
          { status: 409 }
        );
      }

      const [
        { data: teams, error: teamsError },
        { data: acknowledgements, error: ackError },
      ] = await Promise.all([
        admin
          .from("teams")
          .select("id")
          .eq("event_id", event.id)
          .eq("is_active", true),
        admin
          .from("emergency_broadcast_acknowledgements")
          .select("team_id")
          .eq("broadcast_id", broadcastId),
      ]);

      if (teamsError) throw teamsError;
      if (ackError) throw ackError;

      const acknowledgedIds = new Set(
        (acknowledgements || []).map((row: any) => row.team_id)
      );

      const pendingTeamIds = (teams || [])
        .map((team: any) => team.id)
        .filter((id: string) => !acknowledgedIds.has(id));

      if (!pendingTeamIds.length) {
        return NextResponse.json({
          success: true,
          pendingTeams: 0,
          push: {
            attempted: 0,
            delivered: 0,
            failed: 0,
            configured: Boolean(
              process.env.VAPID_PUBLIC_KEY &&
              process.env.VAPID_PRIVATE_KEY
            ),
          },
        });
      }

      const push = await sendPush(
        admin,
        event.id,
        broadcast,
        pendingTeamIds
      );

      return NextResponse.json({
        success: true,
        pendingTeams: pendingTeamIds.length,
        push,
      });
    }

    const broadcastType = String(body.broadcastType || "custom");
    const title = String(body.title || "").trim().slice(0, 120);
    const message = String(body.message || "").trim().slice(0, 1500);

    if (!title || !message) {
      return NextResponse.json(
        { error: "Broadcast title and message are required." },
        { status: 400 }
      );
    }

    await admin
      .from("emergency_broadcasts")
      .update({
        is_active: false,
        ended_at: new Date().toISOString(),
      })
      .eq("event_id", event.id)
      .eq("is_active", true);

    const { data, error } = await admin
      .from("emergency_broadcasts")
      .insert({
        event_id: event.id,
        broadcast_type: broadcastType,
        title,
        message,
        is_active: true,
        created_by: "Control Centre",
      })
      .select("id,title,message,broadcast_type,is_active,created_at")
      .single();

    if (error) throw error;

    /*
     * v0.06.483:
     * Await push delivery before completing the Vercel request.
     * Previously this used `void sendPush(...)`, so the serverless
     * invocation could finish before Web Push delivery completed.
     */
    const [push, gameMasterPush] = await Promise.all([
      sendPush(admin,event.id,data),
      sendGameMasterPush(admin,event.id,data),
    ]);

    return NextResponse.json({success:true,broadcast:data,push,gameMasterPush});
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send emergency broadcast." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isControlRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = adminClient();
    const event = await getEvent(admin);
    const body = await request.json();
    const broadcastId = String(body.broadcastId || "");

    if (!broadcastId) {
      return NextResponse.json(
        { error: "Broadcast ID is required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await admin
      .from("emergency_broadcasts")
      .update({
        is_active: false,
        ended_at: now,
      })
      .eq("id", broadcastId)
      .eq("event_id", event.id)
      .eq("is_active", true)
      .select("id,is_active,ended_at")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Broadcast was already ended or was not found." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      broadcast: data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to end emergency broadcast." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isControlRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = adminClient();
    const event = await getEvent(admin);

    const { data: ended, error: readError } = await admin
      .from("emergency_broadcasts")
      .select("id")
      .eq("event_id", event.id)
      .eq("is_active", false);

    if (readError) throw readError;

    const ids = (ended || []).map((row: any) => row.id);

    if (!ids.length) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    // Acknowledgements cascade when their parent broadcast is deleted.
    const { error: deleteError } = await admin
      .from("emergency_broadcasts")
      .delete()
      .in("id", ids);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      success: true,
      deleted: ids.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to clear Emergency Broadcast history.",
      },
      { status: 500 }
    );
  }
}
