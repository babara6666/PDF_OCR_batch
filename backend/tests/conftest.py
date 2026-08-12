"""
Test configuration.

pypdfium2 raises a first-chance access violation while loading the bundled
PDFium DLL on Windows. Windows structured exception handling swallows it and
the library works fine — every test still passes — but pytest's faulthandler
plugin prints the stack and leaves the process exit code at 255, which makes
a green run look like a failure. Disable faulthandler so the exit code
reflects the test results.
"""

import faulthandler
import sys

import pytest


@pytest.hookimpl(trylast=True)
def pytest_configure(config):
    # trylast: pytest's own faulthandler plugin enables it during configure,
    # so this has to run after it to win.
    if sys.platform == "win32":
        faulthandler.disable()
