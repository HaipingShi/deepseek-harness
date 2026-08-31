"""Integration test for installing the Z.AI provider into Graphiti MCP v1.0.2."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class InstallTests(unittest.TestCase):
    """Verify the exact-source patch and the resulting factory selection."""

    def test_installs_explicit_zai_provider_into_a_source_copy(self):
        source_root = Path(os.environ.get("GRAPHITI_SOURCE_ROOT", "/app/mcp/src"))
        installer = Path(__file__).with_name("install.py")

        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "src"
            shutil.copytree(source_root, target)
            subprocess.run(
                [sys.executable, str(installer), str(target)],
                check=True,
                capture_output=True,
                text=True,
            )

            schema = (target / "config" / "schema.py").read_text()
            factory = (target / "services" / "factories.py").read_text()
            self.assertIn("zai: OpenAIProviderConfig | None = None", schema)
            self.assertIn("case 'zai':", factory)
            self.assertTrue((target / "services" / "zai_graphiti_client.py").is_file())

            environment = dict(os.environ)
            environment["PYTHONPATH"] = str(target)
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


if __name__ == "__main__":
    unittest.main()
