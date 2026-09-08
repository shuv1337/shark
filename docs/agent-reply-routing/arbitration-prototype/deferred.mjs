// Shuvcode-specific research seam. The future durable caller owns the exact
// input and stable msg_ ID before invoking this operation or retrying it.
export async function admitDeferredReply({ native, sessionID, input }) {
  if (
    typeof sessionID !== "string" ||
    sessionID.length < 1 ||
    sessionID.length > 512 ||
    !/^msg_[A-Za-z0-9_-]{1,180}$/.test(input.id) ||
    typeof input.text !== "string" ||
    input.text.length < 1 ||
    input.text.length > 12_000
  )
    throw new Error("Invalid bound deferred intent");
  try {
    const result = await native("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      id: input.id,
      text: input.text,
      delivery: "queue",
    });
    if (result.status === 404) return { status: "missing" };
    if (result.status === 409) return { status: "conflict" };
    if (result.status !== 200) return { status: "unknown" };
    const receipt = result.body?.data;
    if (
      !receipt ||
      receipt.id !== input.id ||
      receipt.sessionID !== sessionID ||
      receipt.type !== "user" ||
      typeof receipt.payload?.text !== "string"
    )
      return { status: "unknown" };
    // Native prompt IDs are first-admission-wins, including changed payloads.
    // A 200 alone cannot prove that this particular reply was accepted.
    return receipt.payload.text === input.text && receipt.delivery === "queue"
      ? { status: "accepted" }
      : { status: "conflict" };
  } catch {
    return { status: "unknown" };
  }
}
