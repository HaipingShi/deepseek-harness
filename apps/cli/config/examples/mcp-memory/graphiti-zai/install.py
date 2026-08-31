"""Install version-locked Z.AI and FalkorDB compatibility patches."""

from __future__ import annotations

from importlib.util import find_spec
from pathlib import Path
import shutil
import sys


def _replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text()
    occurrences = source.count(old)
    if occurrences != 1:
        raise RuntimeError(
            f"expected one Graphiti v1.0.2 patch anchor in {path}, found {occurrences}"
        )
    path.write_text(source.replace(old, new, 1))


def _find_graphiti_core_root() -> Path:
    spec = find_spec("graphiti_core")
    if spec is None or spec.origin is None:
        raise RuntimeError("Graphiti Core is not installed")
    return Path(spec.origin).resolve().parent


def install(source_root: Path) -> None:
    """Add the explicit `zai` provider and escape FalkorDB group-id hyphens."""

    schema_path = source_root / "config" / "schema.py"
    factory_path = source_root / "services" / "factories.py"
    graphiti_core_root = _find_graphiti_core_root()
    legacy_falkor_driver_path = graphiti_core_root / "driver" / "falkordb_driver.py"
    falkor_search_path = graphiti_core_root / "driver" / "falkordb" / "operations" / "search_ops.py"
    client_source = Path(__file__).with_name("zai_graphiti_client.py")
    client_target = source_root / "services" / "zai_graphiti_client.py"

    if client_target.exists():
        raise RuntimeError(f"refusing to replace existing {client_target}")
    if not schema_path.is_file() or not factory_path.is_file():
        raise RuntimeError(f"Graphiti MCP v1.0.2 source tree is incomplete: {source_root}")
    missing_core_paths = [
        path for path in (legacy_falkor_driver_path, falkor_search_path) if not path.is_file()
    ]
    if missing_core_paths:
        raise RuntimeError(f"Graphiti Core 0.28.2 files are missing: {missing_core_paths}")

    _replace_once(
        schema_path,
        "class LLMProvidersConfig(BaseModel):\n"
        "    \"\"\"LLM providers configuration.\"\"\"\n"
        "\n"
        "    openai: OpenAIProviderConfig | None = None\n"
        "    azure_openai: AzureOpenAIProviderConfig | None = None\n",
        "class LLMProvidersConfig(BaseModel):\n"
        "    \"\"\"LLM providers configuration.\"\"\"\n"
        "\n"
        "    openai: OpenAIProviderConfig | None = None\n"
        "    zai: OpenAIProviderConfig | None = None\n"
        "    azure_openai: AzureOpenAIProviderConfig | None = None\n",
    )
    _replace_once(
        factory_path,
        "from graphiti_core.llm_client.config import LLMConfig as GraphitiLLMConfig\n",
        "from graphiti_core.llm_client.config import LLMConfig as GraphitiLLMConfig\n"
        "from services.zai_graphiti_client import ZaiGraphitiClient\n",
    )
    _replace_once(
        factory_path,
        "                    return OpenAIClient(config=llm_config, reasoning=None, verbosity=None)\n"
        "\n"
        "            case 'azure_openai':\n",
        "                    return OpenAIClient(config=llm_config, reasoning=None, verbosity=None)\n"
        "\n"
        "            case 'zai':\n"
        "                if not config.providers.zai:\n"
        "                    raise ValueError('Z.AI provider configuration not found')\n"
        "\n"
        "                provider_config = config.providers.zai\n"
        "                api_key = provider_config.api_key\n"
        "                _validate_api_key('Z.AI', api_key, logger)\n"
        "                llm_config = GraphitiLLMConfig(\n"
        "                    api_key=api_key,\n"
        "                    base_url=provider_config.api_url,\n"
        "                    model=config.model,\n"
        "                    small_model=config.model,\n"
        "                    temperature=config.temperature,\n"
        "                    max_tokens=config.max_tokens,\n"
        "                )\n"
        "                return ZaiGraphitiClient(config=llm_config)\n"
        "\n"
        "            case 'azure_openai':\n",
    )
    for path in (legacy_falkor_driver_path, falkor_search_path):
        _replace_once(
            path,
            "        escaped_group_ids = [f'\"{gid}\"' for gid in group_ids]\n",
            "        escaped_group_ids = "
            "['\"' + gid.replace('-', r'\\-') + '\"' for gid in group_ids]\n",
        )
    shutil.copyfile(client_source, client_target)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: install.py <graphiti-src-directory>")
    install(Path(sys.argv[1]).resolve())
