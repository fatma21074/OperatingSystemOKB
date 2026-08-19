import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { username, password } = await request.json();
    if (!String(username || "").trim() || !String(password || "")) {
      return json({ error: "بيانات الدخول غير صحيحة" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("OKB_JWT_SECRET")!;
    if (!url || !serviceKey || !jwtSecret) throw new Error("Missing function secrets");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc("verify_okb_credentials", {
      p_username: String(username).trim(),
      p_password: String(password),
    });
    const user = Array.isArray(data) ? data[0] : null;
    if (error || !user) return json({ error: "بيانات الدخول غير صحيحة" }, 401);

    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      role: "authenticated",
      app_role: user.role,
      username: user.username,
      name: user.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setAudience("authenticated")
      .setIssuedAt(now)
      .setExpirationTime(now + 12 * 60 * 60)
      .sign(new TextEncoder().encode(jwtSecret));

    return json({ token, expires_at: now + 12 * 60 * 60, user });
  } catch (error) {
    console.error(error);
    return json({ error: "تعذر تسجيل الدخول الآن" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
