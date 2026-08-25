import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify, SignJWT } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("OKB_JWT_SECRET")!;
    if (!url || !serviceKey || !jwtSecret) throw new Error("Missing function secrets");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    if (body?.action === "refresh") {
      const oldToken = String(body?.token || "").trim();
      if (!oldToken) return json({ error: "Missing session token" }, 401);
      const { payload } = await jwtVerify(oldToken, new TextEncoder().encode(jwtSecret), {
        audience: "authenticated",
        algorithms: ["HS256"],
        clockTolerance: 120,
      });
      if (!payload.sub) return json({ error: "Invalid session" }, 401);
      const { data: refreshedUser, error: refreshError } = await admin
        .from("user")
        .select("id,name,username,role,active,managed_branches,system_permissions")
        .eq("id", payload.sub)
        .eq("active", true)
        .single();
      if (refreshError || !refreshedUser) return json({ error: "Session user is unavailable" }, 401);
      return issueSession(refreshedUser, jwtSecret);
    }

    const username = body?.username;
    const password = body?.password;
    if (!String(username || "").trim() || !String(password || "")) {
      return json({ error: "بيانات الدخول غير صحيحة" }, 401);
    }
    const { data, error } = await admin.rpc("verify_okb_credentials", {
      p_username: String(username).trim(),
      p_password: String(password),
    });
    const user = Array.isArray(data) ? data[0] : null;
    if (error || !user) return json({ error: "بيانات الدخول غير صحيحة" }, 401);

    return issueSession(user, jwtSecret);
  } catch (error) {
    console.error(error);
    return json({ error: "تعذر تسجيل الدخول الآن" }, 500);
  }
});

async function issueSession(user: Record<string, unknown>, jwtSecret: string) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60;
  const token = await new SignJWT({
    role: "authenticated",
    app_role: user.role,
    username: user.username,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user.id))
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(jwtSecret));
  return json({ token, expires_at: expiresAt, user });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
