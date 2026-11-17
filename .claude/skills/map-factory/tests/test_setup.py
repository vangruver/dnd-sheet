"""Tests for scripts/setup.py."""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from setup import check_python_version, check_api_key


class TestCheckPythonVersion:
    def test_python_39_passes(self):
        with patch.object(sys, "version_info", (3, 9, 0)):
            # Should not raise
            check_python_version()

    def test_python_38_passes(self):
        with patch.object(sys, "version_info", (3, 8, 0)):
            check_python_version()

    def test_python_312_passes(self):
        with patch.object(sys, "version_info", (3, 12, 0)):
            check_python_version()

    def test_python_37_fails(self):
        with patch.object(sys, "version_info", (3, 7, 0)):
            with pytest.raises(SystemExit):
                check_python_version()

    def test_python_27_fails(self):
        with patch.object(sys, "version_info", (2, 7, 0)):
            with pytest.raises(SystemExit):
                check_python_version()


class TestCheckApiKey:
    def test_api_key_set(self, capsys):
        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            check_api_key()
        captured = capsys.readouterr()
        assert "OK" in captured.out

    def test_api_key_not_set(self, capsys):
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("STABILITY_API_KEY", None)
            check_api_key()
        captured = capsys.readouterr()
        assert "Warning" in captured.out
        assert "platform.stability.ai" in captured.out
