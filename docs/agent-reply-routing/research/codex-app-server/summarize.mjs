import { createHash } from "node:crypto";

export function summarizeEvidence(raw, rawText, rawEvidenceFile) {
  const observations = raw.observations;
  const one = (name) => observations.find((o) => o.name === name)?.value;
  const userItems = (name) =>
    one(name)?.result?.thread?.turns.flatMap((turn) =>
      turn.items
        .filter((item) => item.type === "userMessage")
        .map((item) => ({ turnId: turn.id, itemId: item.id, clientId: item.clientId })),
    ) ?? [];
  const count = (name, id) => userItems(name).filter((item) => item.clientId === id).length;
  const checks = [];
  const check = (id, source, observed, expected) => checks.push({ id, source, observed, expected });
  check(
    "probe_completed",
    "observations[].name",
    observations.some((o) => o.name === "failure"),
    false,
  );
  check(
    "active_rejoin",
    "observer.resumeActive.result.thread.status.type",
    one("observer.resumeActive")?.result.thread.status.type,
    "active",
  );
  check(
    "completion_subscription",
    "observer.completed.params.turn.status",
    one("observer.completed")?.params.turn.status,
    "completed",
  );
  check(
    "completed_delivery_not_deduplicated",
    "readAfterDuplicate.result.thread.turns[].items[].clientId",
    count("readAfterDuplicate", "delivery_synthetic_first"),
    2,
  );
  check(
    "busy_delivery_not_deduplicated",
    "restart.readBeforeResume.result.thread.turns[].items[].clientId",
    count("restart.readBeforeResume", "delivery_synthetic_second_client"),
    2,
  );
  const queue = one("queueList")?.result.data ?? [];
  check(
    "queue_delivery_not_deduplicated",
    "queueList.result.data[].id",
    new Set(queue.map((q) => q.id)).size,
    2,
  );
  check(
    "persisted_crash_delivery_found",
    "restart.readBeforeResume.result.thread.turns[].items[].clientId",
    count("restart.readBeforeResume", "delivery_synthetic_crash"),
    1,
  );
  check(
    "queue_correlation_survives_restart",
    "restart.queueBeforeResume.result.data[0].clientUserMessageId",
    one("restart.queueBeforeResume")?.result.data[0]?.clientUserMessageId,
    "delivery_synthetic_crash_queue",
  );
  check(
    "stale_steer_rejected",
    "staleSteer.error.message",
    /expected active turn id/.test(one("staleSteer")?.error.message),
    true,
  );
  check(
    "other_writer_rejected",
    "otherProcess.resumeActiveOwner.error.message",
    /already has an active writer/.test(one("otherProcess.resumeActiveOwner")?.error.message),
    true,
  );
  check(
    "only_one_model_owner",
    "concurrentProcesses.heldModelCalls",
    one("concurrentProcesses")?.heldModelCalls,
    1,
  );
  const question = one("desktop.nativeQuestion");
  check(
    "question_shared_request_id",
    "nativeQuestionRequestIds",
    Object.values(one("nativeQuestionRequestIds") ?? {}).every((id) => id === question?.id),
    true,
  );
  check(
    "question_replayed_on_rejoin",
    "reconnect.pendingRequests[0].id",
    one("reconnect.pendingRequests")?.[0]?.id,
    question?.id,
  );
  check(
    "one_resolution_per_client",
    "resolutionEvents[].events[].params.requestId",
    one("resolutionEvents")?.map(
      (client) => client.events.filter((event) => event.params.requestId === question?.id).length,
    ),
    [1, 1, 1],
  );
  check(
    "approval_replayed_on_rejoin",
    "approval_reconnect.request.id",
    one("approval_reconnect.request")?.id,
    one("desktop.nativeApproval")?.id,
  );
  for (const name of ["turnsPage", "itemsPage", "timelinePage"]) {
    check(
      `${name}_cursor`,
      `${name}.result.nextCursor`,
      typeof one(name)?.result.nextCursor,
      "string",
    );
  }
  const crashes = observations
    .filter((o) => o.name === "immediateAdmissionCrash")
    .map((o) => o.value);
  check("ack_crash_iterations", "immediateAdmissionCrash[]", crashes.length, 5);
  check(
    "ack_crash_responses_received",
    "immediateAdmissionCrash[].acknowledgedTurnId",
    crashes.filter((c) => c.acknowledgedTurnId).length,
    5,
  );
  check(
    "ack_crash_read_errors",
    "immediateAdmissionCrash[].error",
    crashes.filter((c) => c.error).length,
    0,
  );
  check(
    "ack_crash_matching_items",
    "immediateAdmissionCrash[].matchingItems.length",
    crashes.map((c) => c.matchingItems?.length),
    [0, 0, 0, 0, 0],
  );
  check(
    "shared_terminal_followup_visible",
    "terminal.followupVisible.sawUniqueInput",
    one("terminal.followupVisible")?.sawUniqueInput,
    true,
  );
  check(
    "shared_terminal_followup_persisted",
    "terminal.readAfterFollowup.result.thread.turns[].items[].clientId",
    count("terminal.readAfterFollowup", "delivery_synthetic_terminal_followup"),
    1,
  );
  check(
    "default_terminal_really_started",
    "defaultTerminal.started.heldModelCalls",
    one("defaultTerminal.started")?.heldModelCalls,
    1,
  );
  check(
    "default_proxy_unavailable",
    "defaultTerminal.proxy.exitCode",
    one("defaultTerminal.proxy")?.exitCode,
    1,
  );
  check(
    "default_proxy_socket_missing",
    "defaultTerminal.proxy.diagnostic",
    /No such file or directory/.test(one("defaultTerminal.proxy")?.diagnostic),
    true,
  );
  check(
    "default_terminal_writer_rejected",
    "defaultTerminal.otherProcessResume.error.message",
    /already has an active writer/.test(one("defaultTerminal.otherProcessResume")?.error.message),
    true,
  );
  check(
    "temporary_daemon_cleanup",
    "syntheticDaemonStopped.exitCode",
    one("syntheticDaemonStopped")?.exitCode,
    0,
  );

  const snapshot = (name) => {
    const thread = one(name)?.result?.thread;
    return (
      thread && {
        threadId: thread.id,
        source: thread.source,
        status: thread.status,
        turnStatuses: thread.turns.map((turn) => turn.status),
      }
    );
  };
  return {
    schemaVersion: 1,
    runtimeVersion: raw.runtimeVersion,
    model: raw.model,
    rawEvidenceFile,
    rawEvidenceSha256: createHash("sha256").update(rawText).digest("hex"),
    verdict: "blocked",
    checks,
    extracts: {
      duplicateCompletedItems: userItems("readAfterDuplicate"),
      duplicateBusyItems: userItems("restart.readBeforeResume").filter(
        (item) => item.clientId === "delivery_synthetic_second_client",
      ),
      duplicateQueue: queue.map(({ id, clientUserMessageId }) => ({ id, clientUserMessageId })),
      persistedCrashItem: userItems("restart.readBeforeResume").filter(
        (item) => item.clientId === "delivery_synthetic_crash",
      ),
      persistedQueue: one("restart.queueBeforeResume")?.result.data.map(
        ({ id, clientUserMessageId }) => ({ id, clientUserMessageId }),
      ),
      activeQuestion: question,
      activeApproval: one("desktop.nativeApproval"),
      staleSteerError: one("staleSteer")?.error,
      otherWriterError: one("otherProcess.resumeActiveOwner")?.error,
      immediateCrashTurnIds: crashes.map((c) => c.acknowledgedTurnId),
      queueAfterResumeCount: one("restart.queueAfterResume")?.result.data.length,
      snapshotAfterResume: snapshot("restart.readAfterResume"),
      remoteTerminal: one("terminal.start"),
      remoteTerminalFollowup: userItems("terminal.readAfterFollowup").filter(
        (item) => item.clientId === "delivery_synthetic_terminal_followup",
      ),
      defaultProxy: one("defaultTerminal.proxy"),
      defaultTerminalLiveDiskProjection: snapshot("defaultTerminal.otherProcessRead"),
      defaultTerminalWriterError: one("defaultTerminal.otherProcessResume")?.error,
      defaultTerminalCompletedDiskProjection: snapshot("defaultTerminal.completedDiskRead"),
    },
  };
}
