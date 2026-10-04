"""Run only the supplied synthetic Codex terminal client in a real PTY."""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))


def terminate(_signum, _frame):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    raise SystemExit(0)


signal.signal(signal.SIGTERM, terminate)
while True:
    readable, _, _ = select.select([master, sys.stdin], [], [], 1)
    if master in readable:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    if sys.stdin in readable:
        data = os.read(sys.stdin.fileno(), 65536)
        if data:
            os.write(master, data)
    exited, status = os.waitpid(pid, os.WNOHANG)
    if exited:
        raise SystemExit(os.waitstatus_to_exitcode(status))
