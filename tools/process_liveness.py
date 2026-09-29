"""Read-only process checks for app-owned backend watchdogs."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import sys


def process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # os.kill(pid, 0) is NOT a probe on Windows: CPython calls
        # TerminateProcess even for signal 0, killing the Vite/Tauri parent.
        # A synchronization-only handle cannot terminate or modify a process.
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE only
        if not handle:
            # ERROR_INVALID_PARAMETER means this PID no longer exists.
            # Access denied/unknown errors are not proof the parent has exited.
            return ctypes.get_last_error() != 87
        try:
            # WAIT_OBJECT_0 means exited; WAIT_TIMEOUT means still running.
            # Fail open on unexpected wait errors rather than stopping a job.
            return kernel32.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False
