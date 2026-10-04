#!/usr/bin/env python3
"""Read-only CLI inventory and optional disposable, model-free handshake.

No live session ID, title, transcript, path, token, or process ID is printed.
The handshake never sends a user message. Its fresh child has no inherited
credentials, no persisted session, and a loopback-only model endpoint.
"""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone


SDK_VERSION = "0.3.263"
SDK_INTEGRITY = "0QWoHgWWlSmgXfEqZRbVYRoXT9p4tx/yKaZ4eLJ8l1MR65SIvMGR+cd5ZXUpGYZpj9RzbYiYU9LoFg90mdIjmw=="
PINNED_CLI_SHA256 = "ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9"


def inventory(executable):
    version = subprocess.run(
        [executable, "--version"], capture_output=True, text=True, timeout=20
    )
    listed = subprocess.run(
        [executable, "agents", "--json"], capture_output=True, text=True, timeout=20
    )
    result = {
        "version": version.stdout.strip(),
        "binary_sha256": hashlib.sha256(Path(executable).resolve().read_bytes()).hexdigest(),
        "inventory_exit": listed.returncode,
    }
    try:
        rows = json.loads(listed.stdout)
    except (json.JSONDecodeError, ValueError):
        result["inventory_shape"] = "unparseable"
        return result
    result["inventory_shape"] = "array" if isinstance(rows, list) else "other"
    if isinstance(rows, list):
        result["count"] = len(rows)
        result["fields"] = sorted({key for row in rows if isinstance(row, dict) for key in row})
        for field, accepted in (
            ("kind", {"interactive", "background"}),
            ("status", {"idle", "working", "running", "waiting", "busy"}),
            ("state", {"working", "blocked", "done", "failed", "stopped"}),
        ):
            result[field + "_counts"] = dict(Counter(
                row.get(field) if row.get(field) in accepted else "other_or_absent"
                for row in rows if isinstance(row, dict)
            ))
    return result


def inspect_sdk():
    url = f"https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-{SDK_VERSION}.tgz"
    data = urllib.request.urlopen(url, timeout=30).read()
    actual = base64.b64encode(hashlib.sha512(data).digest()).decode()
    if actual != SDK_INTEGRITY:
        raise RuntimeError("Pinned SDK integrity mismatch")
    archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    sources = {
        name: archive.extractfile("package/" + name).read().decode()
        for name in ("sdk.d.ts", "bridge.d.ts", "browser-sdk.d.ts")
    }
    # This is static capability evidence, never a successful live attach claim.
    checks = {
        "request_id_in_can_use_tool": ("sdk.d.ts", "requestId: string;"),
        "pending_permissions_in_initialize": ("sdk.d.ts", "pending_permission_requests?: SDKControlRequest[];"),
        "reinitialize_method": ("sdk.d.ts", "reinitialize(): Promise<SDKControlInitializeResponse>;"),
        "custom_spawn_option": ("sdk.d.ts", "spawnClaudeCodeProcess?:"),
        "bridge_worker_credentials": ("bridge.d.ts", "worker_jwt: string;"),
        "bridge_server_epoch": ("bridge.d.ts", "worker_epoch: number;"),
        "bridge_alpha_stability": ("bridge.d.ts", "ALPHA STABILITY"),
        "browser_sse_transport": ("browser-sdk.d.ts", "streamUrl: string;"),
    }
    return {
        "version": SDK_VERSION,
        "tarball_url": url,
        "integrity_sha512_verified": True,
        "executed_or_installed": False,
        "declaration_sha256": {
            name: hashlib.sha256(source.encode()).hexdigest()
            for name, source in sources.items()
        },
        "static_checks": {key: needle in sources[name] for key, (name, needle) in checks.items()},
    }


def handshake(executable):
    with tempfile.TemporaryDirectory(prefix="probe-state-", dir=Path(__file__).parent) as state:
        env = {
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": os.environ["HOME"],  # Preserve HOME; isolate Claude using its supported setting.
            "CLAUDE_CONFIG_DIR": state,
            "TMPDIR": state,
            "ANTHROPIC_API_KEY": "synthetic-offline-probe-key",
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:9",
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
        command = [
            executable, "--bare", "--print", "--verbose",
            "--input-format", "stream-json", "--output-format", "stream-json",
            "--no-session-persistence", "--tools", "", "--setting-sources", "",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
        ]
        child = subprocess.Popen(
            command, cwd=state, env=env, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ, "stdout")
        selector.register(child.stderr, selectors.EVENT_READ, "stderr")
        buffer = b""
        stderr_bytes = 0
        observed = []
        issued = ["shark_probe_initialize_1", "shark_probe_initialize_2"]
        next_request = 0
        deadline = time.monotonic() + 15

        def send_initialize():
            nonlocal next_request
            payload = {
                "type": "control_request", "request_id": issued[next_request],
                "request": {"subtype": "initialize"},
            }
            child.stdin.write((json.dumps(payload) + "\n").encode())
            child.stdin.flush()
            next_request += 1

        try:
            send_initialize()
            complete = False
            while time.monotonic() < deadline and not complete:
                for key, _ in selector.select(timeout=0.25):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if key.data == "stderr":
                        stderr_bytes += len(chunk)
                        continue
                    buffer += chunk
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        try:
                            frame = json.loads(line)
                        except (ValueError, UnicodeDecodeError):
                            observed.append({"type": "unparseable"})
                            continue
                        summary = {"type": frame.get("type"), "fields": sorted(frame)}
                        response = frame.get("response")
                        if isinstance(response, dict):
                            summary["response_subtype"] = response.get("subtype")
                            summary["response_fields"] = sorted(response)
                            summary["matches_probe_request"] = response.get("request_id") in issued
                            payload = response.get("response")
                            if isinstance(payload, dict):
                                summary["payload_fields"] = sorted(payload)
                            for pending in ("pending_permission_requests", "pending_user_dialog_requests"):
                                if isinstance(response.get(pending), list):
                                    summary[pending + "_count"] = len(response[pending])
                            if response.get("request_id") == issued[0] and next_request == 1:
                                send_initialize()
                            elif response.get("request_id") == issued[1]:
                                complete = True
                        observed.append(summary)
                if child.poll() is not None and not selector.get_map():
                    break
        finally:
            selector.close()
            child.stdin.close()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
        # The pinned binary's argument validator rejects this pair before
        # starting a background worker. Never try it on a changed binary.
        compatibility = {"status": "not_run_binary_changed"}
        if hashlib.sha256(Path(executable).resolve().read_bytes()).hexdigest() == PINNED_CLI_SHA256:
            rejected = subprocess.run(
                [executable, "--bare", "--bg", "--print"],
                cwd=state, env=env, capture_output=True, text=True, timeout=10,
            )
            output = rejected.stdout + rejected.stderr
            expected = "--bg and --print conflict: --print never starts the interactive session"
            compatibility = {
                "exit_code": rejected.returncode,
                "explicit_bg_print_conflict": expected in output,
                "unattachable_diagnostic": "so the job would be unattachable" in output,
                "raw_output_saved": False,
            }
        return {
            "fresh_child_only": True, "user_messages_sent": 0,
            "model_endpoint": "loopback_port_9", "inherited_credentials": False,
            "requests_sent": next_request, "observed_frames": observed,
            "stderr_bytes_redacted": stderr_bytes, "child_exit_code": child.returncode,
            "temporary_state_removed_on_return": True,
            "native_background_compatibility": compatibility,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handshake", action="store_true")
    parser.add_argument("--inspect-sdk", action="store_true")
    args = parser.parse_args()
    executable = shutil.which("claude")
    if executable is None:
        raise SystemExit("Claude CLI not found")
    result = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "inventory": inventory(executable),
    }
    if args.inspect_sdk:
        result["sdk"] = inspect_sdk()
    if args.handshake:
        result["handshake"] = handshake(executable)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
