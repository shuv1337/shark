import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Research seam only. The caller must durably bind this exact intent before
// calling; this function owns neither a queue nor an agent process.
export function requestDigest(request) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

export async function reconcileActiveReply({ native, target, intent }) {
  if (
    !["form", "permission"].includes(target.kind) ||
    ![target.sessionID, target.requestID].every(
      (value) => typeof value === "string" && value.length > 0 && value.length <= 512,
    ) ||
    typeof intent.responseID !== "string" ||
    intent.responseID.length < 1 ||
    intent.responseID.length > 200 ||
    !/^[a-f0-9]{64}$/.test(target.digest)
  ) {
    throw new Error("Invalid bound active-request intent");
  }
  const route = `/api/session/${encodeURIComponent(target.sessionID)}/${target.kind}/${encodeURIComponent(target.requestID)}`;
  const classify = (receipt) => {
    if (
      !receipt ||
      receipt.request?.id !== target.requestID ||
      receipt.request?.sessionID !== target.sessionID
    ) {
      return { status: "unknown", reason: "receipt_unavailable" };
    }
    if (requestDigest(receipt.request) !== target.digest) {
      return { status: "stale", reason: "request_changed" };
    }
    if (receipt.state?.status === "answered") {
      const expected =
        target.kind === "form"
          ? { status: "answered", answer: intent.payload.answer }
          : {
              status: "answered",
              reply: intent.payload.reply,
              ...(intent.payload.message === undefined ? {} : { message: intent.payload.message }),
            };
      return receipt.responseID === intent.responseID && isDeepStrictEqual(receipt.state, expected)
        ? { status: "accepted" }
        : { status: "superseded", reason: "another_response_won" };
    }
    if (receipt.state?.status === "cancelled") {
      return { status: "stale", reason: "request_cancelled" };
    }
    if (receipt.state?.status !== "pending" || receipt.available !== true) {
      return { status: "unknown", reason: "callback_unavailable" };
    }
    return undefined;
  };
  const read = async () => {
    try {
      const result = await native("GET", `${route}/receipt`);
      return result.status === 200 ? result.body?.data : undefined;
    } catch {
      return undefined;
    }
  };
  const before = classify(await read());
  if (before) return before;
  try {
    // At most one POST per attempt. Even HTTP success is reconciled against the
    // authoritative receipt; a local claim or transport ACK is insufficient.
    await native("POST", `${route}/reply`, {
      ...intent.payload,
      responseID: intent.responseID,
    });
  } catch {
    // A failed transport may already have committed. Never allocate a new ID.
  }
  return classify(await read()) ?? { status: "unknown", reason: "admission_unconfirmed" };
}

// Agent creator credentials can cancel, but cannot impersonate a phone reply.
// The caller persists this outcome with its original intent and losing input.
export async function settleSharkInteraction({ outcome, get, cancel }) {
  let interaction;
  try {
    interaction = (await get()).interaction;
    if (interaction.status === "pending" && outcome.status !== "unknown") {
      try {
        interaction = (await cancel()).interaction;
      } catch {
        // Includes replied/cancel races and lost cancellation responses.
        interaction = (await get()).interaction;
      }
    }
  } catch {
    return { ...outcome, sharkStatus: "unknown", cleanupPending: true };
  }
  return {
    ...outcome,
    sharkStatus: interaction.status,
    cleanupPending: interaction.status === "pending" && outcome.status !== "unknown",
    conflictingReply:
      ["replied", "approved", "denied", "yes", "no"].includes(interaction.status) &&
      outcome.status !== "accepted",
  };
}
