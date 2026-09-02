import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AuditRequest = {
  order_id: string;
  proof_type: "secretary" | "collection";
  image_url: string;
  expected_amount: number;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("OKB_JWT_SECRET")!;
    if (!url || !serviceKey || !jwtSecret) throw new Error("Missing function secrets");

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing session" }, 401);
    await jwtVerify(token, new TextEncoder().encode(jwtSecret), {
      audience: "authenticated", algorithms: ["HS256"], clockTolerance: 120,
    });

    const body = await request.json() as AuditRequest;
    if (!body.order_id || !["secretary", "collection"].includes(body.proof_type) || !body.image_url) {
      return json({ error: "Invalid OCR audit request" }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const expected = Math.max(0, Number(body.expected_amount || 0));
    const pending = {
      order_id: body.order_id,
      proof_type: body.proof_type,
      image_url: body.image_url,
      expected_amount: expected,
      extracted_amount: null,
      difference: null,
      confidence: null,
      status: "pending",
      extracted_text: null,
      candidates: [],
      error_message: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { error: pendingError } = await admin.from("payment_ocr_audits")
      .upsert(pending, { onConflict: "order_id,proof_type" });
    if (pendingError) throw pendingError;

    // Complete the first review before replying. This makes the browser call a
    // reliable acknowledgement instead of losing background work when an Edge
    // isolate is recycled immediately after the response.
    await processAudit(admin, body, expected);
    const { data: completed } = await admin.from("payment_ocr_audits")
      .select("status,extracted_amount,difference,confidence,error_message")
      .eq("order_id", body.order_id).eq("proof_type", body.proof_type).maybeSingle();
    return json({ accepted: true, audit: completed || null }, 200);
  } catch (error) {
    console.error("OCR request failed", error);
    return json({ error: error instanceof Error ? error.message : "OCR request failed" }, 500);
  }
});

async function processAudit(admin: ReturnType<typeof createClient>, body: AuditRequest, expected: number) {
  try {
    const apiKey = Deno.env.get("GOOGLE_VISION_API_KEY") || "";
    if (!apiKey) {
      await updateAudit(admin, body, { status: "service_not_configured", error_message: "GOOGLE_VISION_API_KEY is not configured" });
      return;
    }

    const imageResponse = await fetch(body.image_url, { cache: "no-store" });
    if (!imageResponse.ok) throw new Error(`Cannot download proof image (${imageResponse.status})`);
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const base64 = bytesToBase64(bytes);
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["ar", "en"] },
      }] }),
    });
    const vision = await visionResponse.json();
    if (!visionResponse.ok || vision?.responses?.[0]?.error) {
      throw new Error(vision?.responses?.[0]?.error?.message || `Vision API error (${visionResponse.status})`);
    }

    const text = String(vision?.responses?.[0]?.fullTextAnnotation?.text || vision?.responses?.[0]?.textAnnotations?.[0]?.description || "");
    const candidates = extractAmounts(text);
    if (!candidates.length) {
      await updateAudit(admin, body, { status: "unreadable", extracted_text: safeText(text), candidates: [], confidence: 0, reviewed_at: new Date().toISOString() });
      await notifyMismatch(admin, body, expected, null, "تعذر قراءة مبلغ واضح من إثبات الدفع");
      return;
    }

    // Never let the amount entered by the employee bias the OCR decision.
    // Prefer the value printed beside a currency marker (e.g. "600 EGP").
    // Only fall back to the closest generic number when the screenshot has no
    // recognisable monetary anchor, and mark that result for manual review.
    const rankedAmounts = rankPaymentAmounts(text);
    const best = rankedAmounts[0] || null;
    const extracted = best?.value ?? null;
    if(extracted===null){
      await updateAudit(admin, body, { status: "unreadable", extracted_text: safeText(text), candidates: candidates.slice(0,30), confidence: 0, reviewed_at: new Date().toISOString() });
      await notifyMismatch(admin, body, expected, null, "تعذر تحديد مبلغ التحويل من النص المقروء");
      return;
    }
    const difference = Number((extracted - expected).toFixed(2));
    const tolerance = Math.max(1, expected * 0.001);
    const exact = Math.abs(difference) <= tolerance;
    const reliable = best.score >= 70;
    const status = reliable ? (exact ? "verified" : "mismatch") : "multiple";
    const confidence = Math.max(0.45,Math.min(0.99,best.score/200));
    await updateAudit(admin, body, {
      status, extracted_amount: extracted, difference, confidence,
      extracted_text: safeText(text), candidates: candidates.slice(0, 30), reviewed_at: new Date().toISOString(),
    });
    if (status !== "verified") {
      const issue=reliable
        ? `المبلغ الظاهر بجوار العملة لا يطابق المبلغ المسجل (الفرق ${Math.abs(difference).toFixed(2)})`
        : "تم العثور على أرقام متعددة بدون مبلغ عملة واضح؛ يلزم التحقق اليدوي";
      await notifyMismatch(admin, body, expected, extracted, issue);
    }
  } catch (error) {
    console.error("OCR processing failed", error);
    await updateAudit(admin, body, { status: "failed", error_message: error instanceof Error ? error.message : "OCR processing failed", reviewed_at: new Date().toISOString() });
  }
}

async function updateAudit(admin: ReturnType<typeof createClient>, body: AuditRequest, patch: Record<string, unknown>) {
  await admin.from("payment_ocr_audits").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("order_id", body.order_id).eq("proof_type", body.proof_type);
}

async function notifyMismatch(admin: ReturnType<typeof createClient>, body: AuditRequest, expected: number, extracted: number | null, issue: string) {
  const { data: order } = await admin.from("orders").select("id,customer_name,employee_name,branch,shipping_company,order_number,ticket_id").eq("id", body.order_id).single();
  if (!order) return;
  const { data: allUsers } = await admin.from("user").select("id,name,username,role,active").eq("active", true);
  const actorName = String(order.employee_name || "").trim().toLowerCase();
  const recipients = (allUsers || []).filter((user: Record<string, unknown>) => {
    const role = String(user.role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const isManager = ["admin", "account_manager"].includes(role);
    const isActor = [user.name, user.username].some(value => String(value || "").trim().toLowerCase() === actorName);
    return isManager || isActor;
  }).filter((user: Record<string, unknown>, index: number, list: Record<string, unknown>[]) =>
    list.findIndex(item => String(item.username).toLowerCase() === String(user.username).toLowerCase()) === index
  );
  const actor = (allUsers || []).find((user: Record<string, unknown>) => [user.name, user.username].some(value => String(value || "").trim().toLowerCase() === actorName));
  const ticket = order.ticket_id || order.order_number || "—";
  const typeLabel = body.proof_type === "secretary" ? "إثبات السكرتارية" : "إثبات التحصيل من المندوب";
  const message = `مراجعة OCR لإثبات دفع\nالعميل: ${order.customer_name || "—"}\nTicket ID: ${ticket}\nالفرع: ${order.branch || order.shipping_company || "—"}\nنوع الإثبات: ${typeLabel}\nالمبلغ المسجل: ${expected.toFixed(2)}\nالمبلغ المقروء: ${extracted === null ? "غير واضح" : extracted.toFixed(2)}\nالمشكلة: ${issue}\n[OPEN_ORDER:${order.id}]`;
  if (!recipients.length) return;
  await admin.from("chat_messages").insert(recipients.map((receiver: Record<string, unknown>) => ({
    sender_id: String(actor?.id || receiver.id || ""), sender_username: "financial-audit", sender_name: "🛡️ Financial Audit",
    receiver_id: String(receiver.id || ""), receiver_username: String(receiver.username || ""), receiver_name: String(receiver.name || receiver.username || "User"),
    message, is_read: false,
  })));
}

function extractAmounts(input: string): number[] {
  const normalized = normalizeDigits(input);
  const matches = normalized.match(/\b\d{1,3}(?:[ ,]\d{3})+(?:\.\d{1,2})?\b|\b\d{1,7}(?:\.\d{1,2})?\b/g) || [];
  return [...new Set(matches.map(raw => Number(raw.replace(/[ ,]/g, ""))).filter(value => Number.isFinite(value) && value >= 0 && value <= 10000000))];
}

function extractCurrencyAnchoredAmounts(input: string): number[] {
  const normalized = normalizeDigits(input).replace(/\s+/g, " ");
  const number = String.raw`\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d{1,7}(?:\.\d{1,2})?`;
  const currency = String.raw`EGP|ج\.?\s?م|جنيه(?:اً|ا)?`;
  const patterns = [new RegExp(`(${number})\\s*(?:${currency})`, "gi"), new RegExp(`(?:${currency})\\s*(${number})`, "gi")];
  const values:number[]=[];
  for(const pattern of patterns){
    for(const match of normalized.matchAll(pattern)){
      const value=Number(String(match[1]||"").replace(/[ ,]/g,""));
      if(Number.isFinite(value)&&value>=0&&value<=10000000)values.push(value);
    }
  }
  return [...new Set(values)];
}

type RankedAmount={value:number;score:number;line:string;index:number};
function rankPaymentAmounts(input:string):RankedAmount[]{
  const lines=normalizeDigits(input).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const ranked:RankedAmount[]=[];
  const transferWords=/(تم\s*تحويل|تحويل\s*(?:مبلغ|أموال)?|مبلغ\s*التحويل|transfer\s*amount|amount\s*transferred|money\s*sent|payment\s*(?:successful|completed)|عملية\s*ناجحة)/i;
  const currencyWords=/(egp|ج\.?\s?م|جنيه(?:اً|ا)?)/i;
  const excludedWords=/(رسوم|عمولة|تكلفة\s*المعاملة|fee|commission|الرصيد|رصيد\s*محفظتك|balance)/i;
  const identityWords=/(رقم\s*العملية|رقم\s*مرجعي|transaction\s*(?:id|number)|reference|رقم\s*الهاتف|phone|account)/i;
  lines.forEach((line,index)=>{
    const context=[lines[index-1]||'',line,lines[index+1]||''].join(' | ');
    extractAmounts(line).forEach(value=>{
      let score=0;
      if(transferWords.test(line))score+=130;else if(transferWords.test(context))score+=65;
      if(currencyWords.test(line))score+=85;else if(currencyWords.test(context))score+=30;
      if(excludedWords.test(line))score-=180;else if(excludedWords.test(context))score-=70;
      if(identityWords.test(line))score-=150;
      if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line)||/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(line))score-=150;
      if(Number.isInteger(value)&&value>=10000000)score-=200;
      ranked.push({value,score,line,index});
    });
  });
  const bestByValue=new Map<number,RankedAmount>();
  ranked.forEach(item=>{const old=bestByValue.get(item.value);if(!old||item.score>old.score)bestByValue.set(item.value,item);});
  return [...bestByValue.values()].sort((a,b)=>b.score-a.score||a.index-b.index);
}

function normalizeDigits(input: string) {
  return input
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".").replace(/٬/g, ",");
}

function safeText(text: string) { return text.replace(/\s+/g, " ").trim().slice(0, 2000); }
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }); }
