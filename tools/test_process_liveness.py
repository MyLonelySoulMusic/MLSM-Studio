"""No ML imports: exercise the Windows API contract on every platform."""
import os
import subprocess
import sys
import unittest
from unittest import mock

from tools import process_liveness


class ProcessLivenessTests(unittest.TestCase):
    def check_windows(self, *, handle=0x100000001, wait=258, error=0):
        api = mock.Mock()
        api.OpenProcess.return_value = handle
        api.WaitForSingleObject.return_value = wait
        with mock.patch.object(process_liveness.sys, "platform", "win32"), \
             mock.patch.object(process_liveness.ctypes, "WinDLL", return_value=api, create=True), \
             mock.patch.object(process_liveness.ctypes, "get_last_error", return_value=error, create=True), \
             mock.patch.object(process_liveness.os, "kill", side_effect=AssertionError("Must NEVER signal a Windows parent")):
            result = process_liveness.process_is_alive(123)
        api.OpenProcess.assert_called_once_with(0x00100000, False, 123)
        if handle:
            api.WaitForSingleObject.assert_called_once_with(handle, 0)
            api.CloseHandle.assert_called_once_with(handle)
        else:
            api.WaitForSingleObject.assert_not_called()
            api.CloseHandle.assert_not_called()
        return result

    def test_windows_live_parent_is_not_terminated(self):
        self.assertTrue(self.check_windows())

    def test_windows_exited_parent(self):
        self.assertFalse(self.check_windows(wait=0))

    def test_windows_missing_parent(self):
        self.assertFalse(self.check_windows(handle=0, error=87))

    def test_windows_access_denied_is_not_treated_as_exit(self):
        self.assertTrue(self.check_windows(handle=0, error=5))

    def test_windows_unknown_wait_error_is_not_treated_as_exit(self):
        self.assertTrue(self.check_windows(wait=0xFFFFFFFF))

    def test_invalid_pid_never_signals_a_process_group(self):
        with mock.patch.object(process_liveness.os, "kill") as kill:
            self.assertFalse(process_liveness.process_is_alive(0))
            self.assertFalse(process_liveness.process_is_alive(-1))
        kill.assert_not_called()

    def test_posix_behavior_unchanged(self):
        with mock.patch.object(process_liveness.sys, "platform", "darwin"), \
             mock.patch.object(process_liveness.os, "kill") as kill:
            self.assertTrue(process_liveness.process_is_alive(123))
            kill.assert_called_once_with(123, 0)
            kill.side_effect = ProcessLookupError()
            self.assertFalse(process_liveness.process_is_alive(123))
            kill.side_effect = PermissionError()
            self.assertTrue(process_liveness.process_is_alive(123))

    def test_real_child_survives_repeated_checks_and_exit_is_detected(self):
        # Also executes the native kernel32 implementation when run on Windows.
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            for _ in range(10):
                self.assertTrue(process_liveness.process_is_alive(child.pid))
                self.assertIsNone(child.poll())
            self.assertTrue(process_liveness.process_is_alive(os.getpid()))
        finally:
            child.terminate()
            child.wait(timeout=5)
        self.assertFalse(process_liveness.process_is_alive(child.pid))


if __name__ == "__main__":
    unittest.main()
