"""Install the version-locked Z.AI provider into Graphiti MCP v1.0.2 source."""

from __future__ import annotations

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


def install(source_root: Path) -> None:
    """Add the explicit `zai` config row and factory implementation."""

    schema_path = source_root / "config" / "schema.py"
    factory_path = source_root / "services" / "factories.py"
    client_source = Path(__file__).with_name("zai_graphiti_client.py")
    client_target = source_root / "services" / "zai_graphiti_client.py"

    if client_target.exists():
        raise RuntimeError(f"refusing to replace existing {client_target}")
    if not schema_path.is_file() or not factory_path.is_file():
        raise RuntimeError(f"Graphiti source tree is incomplete: {source_root}")

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
    shutil.copyfile(client_source, client_target)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: install.py <graphiti-src-directory>")
    install(Path(sys.argv[1]).resolve())
