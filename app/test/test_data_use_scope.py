from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from data_use_scope import (  # noqa: E402
    OWNER_PRIVATE_SCOPE,
    PUBLIC_SCOPE,
    data_use_scope_from_environment,
)


class DataUseScopeTests(unittest.TestCase):
    def test_scope_must_be_explicit(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be explicit"):
            data_use_scope_from_environment({}, ["collector.py"])

    def test_scope_can_be_selected_by_argument_or_environment(self) -> None:
        self.assertEqual(
            data_use_scope_from_environment({}, ["collector.py", "--scope", OWNER_PRIVATE_SCOPE]),
            OWNER_PRIVATE_SCOPE,
        )
        self.assertEqual(
            data_use_scope_from_environment(
                {"CYCLELENS_DATA_USE_SCOPE": PUBLIC_SCOPE},
                ["collector.py"],
            ),
            PUBLIC_SCOPE,
        )


if __name__ == "__main__":
    unittest.main()
