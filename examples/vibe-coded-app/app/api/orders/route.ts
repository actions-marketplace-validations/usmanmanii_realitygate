import { createClient } from "@supabase/supabase-js";
import { sendReceipt } from "next-email-magic";
import { chargeCard } from "../../../lib/payments";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: Request) {
  const body: any = await request.json();
  const { data } = await supabase.from("orders").insert(body).select().single();
  await chargeCard(body.amount);
  sendReceipt(body.email).catch(() => {});
  return Response.json(data);
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  const { data } = await supabase.from("orders").select("*").eq("user_id", userId);
  return Response.json(data);
}
