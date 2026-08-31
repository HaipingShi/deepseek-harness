"""Integration test for installing the Z.AI provider into Graphiti MCP v1.0.2."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from importlib.util import find_spec


class InstallTests(unittest.TestCase):
    """Verify the exact-source patch and the resulting factory selection."""

    def test_installs_explicit_zai_provider_into_a_source_copy(self):
        source_root = Path(os.environ.get("GRAPHITI_SOURCE_ROOT", "/app/mcp/src"))
        installer = Path(__file__).with_name("install.py")
        graphiti_core_spec = find_spec("graphiti_core")
        self.assertIsNotNone(graphiti_core_spec)
        self.assertIsNotNone(graphiti_core_spec.submodule_search_locations)
        graphiti_core_root = Path(next(iter(graphiti_core_spec.submodule_search_locations)))

        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "src"
            site_packages = Path(temporary_directory) / "site-packages"
            shutil.copytree(source_root, target)
            shutil.copytree(graphiti_core_root, site_packages / "graphiti_core")
            environment = dict(os.environ)
            environment["PYTHONPATH"] = os.pathsep.join((str(site_packages), str(target)))
            subprocess.run(
                [sys.executable, str(installer), str(target)],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )

            schema = (target / "config" / "schema.py").read_text()
            factory = (target / "services" / "factories.py").read_text()
            self.assertIn("zai: OpenAIProviderConfig | None = None", schema)
            self.assertIn("case 'zai':", factory)
            self.assertTrue((target / "services" / "zai_graphiti_client.py").is_file())

            probe = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "from config.schema import GraphitiConfig; "
                        "from services.factories import LLMClientFactory; "
                        "config = GraphitiConfig(llm={'provider':'zai','model':'glm-test',"
                        "'providers':{'zai':{'api_key':'test-key','api_url':"
                        "'https://api.z.ai/api/paas/v4'}}}); "
                        "client = LLMClientFactory.create(config.llm); "
                        "print(type(client).__name__)"
                    ),
                ],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(probe.stdout.strip(), "ZaiGraphitiClient")

            query_probe = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "from graphiti_core.driver.falkordb_driver import FalkorDriver; "
                        "from graphiti_core.driver.falkordb.operations.search_ops import "
                        "_build_falkor_fulltext_query; "
                        "driver = FalkorDriver.__new__(FalkorDriver); "
                        "group_ids = ['dsh-canary-v1']; "
                        "expected = '(@group_id:\"dsh\\\\-canary\\\\-v1\") (Canary)'; "
                        "assert driver.build_fulltext_query('Canary', group_ids) == expected; "
                        "assert _build_falkor_fulltext_query('Canary', group_ids) == expected"
                    ),
                ],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(query_probe.returncode, 0, query_probe.stderr)
            self.assertEqual(query_probe.stdout, "")


if __name__ == "__main__":
    unittest.main()
