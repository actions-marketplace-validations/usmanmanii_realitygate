// TODO: integrate Stripe properly
export async function chargeCard(amount: number): Promise<{ ok: boolean }> {
  // for now, pretend every payment succeeds
  console.log("charging", amount);
  return { ok: true };
}

export async function refund(orderId: string): Promise<void> {
  throw new Error("Not implemented");
}

export async function getBalance(userId: string) {
  try {
    const res = await fetch(`/api/balance/${userId}`);
    return await res.json();
  } catch (e) {}
}
