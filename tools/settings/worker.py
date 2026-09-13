"""Short-lived settings/NVIDIA bridge. Standard library only; keys never leave here."""
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

MODEL = "moonshotai/kimi-k3"
ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_MODEL_MIGRATIONS = {
    # Models previously exposed by the UI but no longer accepted by NVIDIA's
    # chat-completions endpoint. Keep old settings usable without ever retrying
    # a retired endpoint and triggering the expensive local fallback.
    "meta/llama-3.3-70b-instruct": MODEL,
    "qwen/qwen3.5-122b-a10b": MODEL,
    "deepseek-ai/deepseek-v4-pro": MODEL,
    "deepseek-ai/deepseek-v4-flash": MODEL,
    "nvidia/nemotron-3-nano-30b-a3b": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "minimaxai/minimax-m2.7": "minimaxai/minimax-m3",
    "openai/gpt-oss-120b": "openai/gpt-oss-20b",
}
PROVIDERS = {
    "nvidia": {"label": "NVIDIA", "endpoint": ENDPOINT, "model": MODEL, "keys": ["NVIDIA_API_KEY"]},
    "openai": {"label": "OpenAI", "endpoint": "https://api.openai.com/v1/chat/completions", "model": "gpt-5.6-terra", "keys": ["OPENAI_API_KEY"]},
    "gemini": {"label": "Google Gemini", "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "model": "gemini-3.8-flash", "keys": ["GEMINI_API_KEY", "GOOGLE_API_KEY"]},
    "xai": {"label": "xAI / Grok", "endpoint": "https://api.x.ai/v1/chat/completions", "model": "grok-4.6", "keys": ["XAI_API_KEY", "GROK_API_KEY"]},
}


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except FileNotFoundError:
        return {}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".settings-")
    try:
        with os.fdopen(fd, "w", encoding="utf8") as stream:
            json.dump(value, stream, ensure_ascii=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def configuration(root, data, provider=None):
    env = {}
    # Root and desktop .env are server-side only; never expose through VITE_.
    for file in (root / ".env", root / "apps/desktop/.env"):
        if file.is_file():
            for line in file.read_text(encoding="utf8").splitlines():
                match = re.match(r"\s*(?:export\s+)?((?:NVIDIA|OPENAI|GEMINI|GOOGLE|XAI|GROK)_[A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if match:
                    env[match[1]] = match[2].strip().strip("\"'")
    env.update({k: v for k, v in os.environ.items() if re.match(r"^(NVIDIA|OPENAI|GEMINI|GOOGLE|XAI|GROK)_", k)})
    settings = read_json(data / "providers.json")
    provider = provider or settings.get("activeProvider", "nvidia")
    if provider == "local":
        return {"provider": "local", "apiKey": "", "enabled": False, "model": "Qwen2.5 0.5B", "keySource": "none", "endpoint": ""}
    if provider not in PROVIDERS:
        raise ValueError("Unknown provider")
    definition = PROVIDERS[provider]
    stored = settings.get("providers", {}).get(provider, {})
    if not stored and provider == "nvidia":
        stored = read_json(data / "nvidia.json")
    key = "" if stored.get("keyRemoved") else stored.get("apiKey") or next((env[name] for name in definition["keys"] if env.get(name)), "")
    model = stored.get("model") or env.get(provider.upper() + "_MODEL", definition["model"])
    if provider == "nvidia":
        model = NVIDIA_MODEL_MIGRATIONS.get(model, model)
    return {"apiKey": key, "enabled": stored.get("enabled", True),
            "provider": provider, "endpoint": definition["endpoint"],
            "model": model,
            "keySource": "settings" if stored.get("apiKey") else "environment" if key else "none"}


def public_configuration(config):
    return {"configured": bool(config["apiKey"]), "keySource": config["keySource"],
            "enabled": config["enabled"], "model": config["model"], "endpoint": config["endpoint"], "provider": config["provider"]}


def public_settings(root, data):
    return {"activeProvider": read_json(data / "providers.json").get("activeProvider", "nvidia"),
            "providers": {name: public_configuration(configuration(root, data, name)) for name in PROVIDERS}}


def complete(config, messages, max_tokens=1024):
    if not config["enabled"] or not config["apiKey"]:
        raise ValueError(config["provider"] + " not configured or disabled")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 20:
        raise ValueError("Invalid conversation")
    if any(not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str) for m in messages):
        raise ValueError("Invalid messages")
    if sum(len(m["content"]) for m in messages) > 1_800_000:
        raise ValueError("Conversation too large")
    payload = {"model": config["model"], "messages": messages, "stream": False}
    payload["max_completion_tokens" if config["provider"] == "openai" else "max_tokens"] = max_tokens
    request = urllib.request.Request(config["endpoint"], data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + config["apiKey"], "Content-Type": "application/json"})
    # Redirects must not forward the credential to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=45) as response:
            result = json.loads(response.read(2_000_000))
        content = result["choices"][0]["message"].get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError(config["provider"] + " returned an empty answer")
        return {"content": content.strip(), "model": config["model"], "source": config["provider"]}
    except urllib.error.HTTPError as error:
        # Never return the upstream body: it can echo credentials or prompts.
        labels = {
            401: "API key rifiutata",
            403: "accesso al modello non autorizzato",
            404: "modello non trovato",
            410: "endpoint del modello ritirato o non più disponibile",
            429: "limite richieste raggiunto",
        }
        detail = labels.get(error.code, "errore del provider")
        raise ValueError(f'{config["provider"]} · {config["model"]}: {detail} (HTTP {error.code})') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError(config["provider"] + " unavailable or timed out") from None


def cache_paths(root, native):
    paths = {
        "transformers": (root / ".transformers-cache", "Whisper / Qwen / Transformers"),
        "upscaler-models": (root / ".upscaler-cache/pytorch", "Upscaler models"),
        "upscaler-remote": (root / ".upscaler-cache/remote-video-jobs", "Gradio video checkpoints"),
        "upscaler-local": (root / "temp/upscaler", "Upscaler / Frame Booster temporary video"),
        "whisper-native": (Path.home() / ".cache/mlsm-studio/faster-whisper", "Whisper native models"),
    }
    if native:
        paths.update({"audio-jobs": (native / "audio/jobs", "Audio generated files"),
                      "song-player-jobs": (native / "song-player/jobs", "Song Player / Lipsync jobs"),
                      "visual-models": (native / "song-player/visual-speech", "Visual speech models")})
    return paths


def size_of(path):
    if path.is_symlink():
        return 0
    if path.is_file():
        return path.stat().st_size
    if not path.is_dir():
        return 0
    return sum(size_of(child) for child in path.iterdir())


def clear_cache(paths, cache_id):
    if cache_id not in paths:
        raise ValueError("Unknown cache")
    path, _ = paths[cache_id]
    # Refuse links anywhere in the ancestry; targets are a fixed registry, never request paths.
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError("Cache path contains a symbolic link")
    if not path.exists():
        return {"removedBytes": 0}
    if cache_id == "upscaler-remote":
        try:
            request = urllib.request.Request("http://127.0.0.1:8765/upscale/remote/video/cache", method="DELETE")
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError(local_cache_error(error)) from None
        except urllib.error.URLError:
            pass  # backend stopped: no worker can race this removal
    elif cache_id in ("upscaler-local", "upscaler-models"):
        endpoint = {
            "upscaler-local": "upscaler-video-temp",
            "upscaler-models": "upscaler-models",
        }[cache_id]
        try:
            request = urllib.request.Request("http://127.0.0.1:8765/cache/" + endpoint, method="DELETE")
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError(local_cache_error(error)) from None
        except urllib.error.URLError:
            pass  # service stopped: clear the same registered directory directly
    amount = size_of(path)
    # Remove the contents only, retaining the validated cache directory.
    for child in path.iterdir():
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
    return {"removedBytes": amount}


def local_cache_error(error):
    """Return a useful local-service error without exposing arbitrary response data."""
    try:
        payload = json.loads(error.read(32_000))
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if isinstance(detail, dict):
            detail = detail.get("message")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    return "Cache occupata: termina i job attivi e riprova / finish active jobs and retry"


def dispatch(request, root, data, native=None):
    action = request.get("action")
    config = configuration(root, data, request.get("provider") if action in ("test", "chat") else None)
    if action == "status":
        return public_settings(root, data)
    if action == "configure":
        settings = read_json(data / "providers.json")
        provider = request.get("provider", "nvidia")
        if provider not in PROVIDERS:
            raise ValueError("Unknown provider")
        if "activeProvider" in request:
            if request["activeProvider"] not in (*PROVIDERS, "local"):
                raise ValueError("Unknown active provider")
            settings["activeProvider"] = request["activeProvider"]
        stored = settings.setdefault("providers", {}).setdefault(provider, {})
        if "model" in request:
            model = request["model"]
            if not isinstance(model, str) or not re.fullmatch(r"[a-zA-Z0-9_./:-]{1,180}", model):
                raise ValueError("Invalid model ID")
            stored["model"] = model
        if "enabled" in request:
            if not isinstance(request["enabled"], bool):
                raise ValueError("Invalid enabled value")
            stored["enabled"] = request["enabled"]
        if "apiKey" in request:
            key = request["apiKey"]
            if not isinstance(key, str) or len(key) > 4096 or any(c.isspace() for c in key):
                raise ValueError("Invalid API key")
            stored["apiKey"] = key
            stored["keyRemoved"] = False
        if request.get("removeKey") is True:
            stored.pop("apiKey", None)
            stored["keyRemoved"] = True
        write_json(data / "providers.json", settings)
        return public_settings(root, data)
    if action == "chat":
        max_tokens = request.get("maxTokens", 1024)
        if not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or not 128 <= max_tokens <= 8192:
            raise ValueError("Invalid max token limit")
        return complete(config, request.get("messages"), max_tokens=max_tokens)
    if action == "test":
        if "model" in request:
            model = request["model"]
            if not isinstance(model, str) or not re.fullmatch(r"[a-zA-Z0-9_./:-]{1,180}", model):
                raise ValueError("Invalid model ID")
            config["model"] = model
        # Reasoning models can consume a tiny generation budget before emitting
        # visible content. Eight tokens produced false negatives (notably Kimi
        # K3); 128 remains cheap while allowing a real, observable answer.
        complete(config, [{"role": "user", "content": "Reply with OK only."}], max_tokens=128)
        return {"ok": True, "model": config["model"]}
    paths = cache_paths(root, native)
    if action == "caches":
        return [{"id": key, "label": label, "path": str(path), "bytes": size_of(path)} for key, (path, label) in paths.items()]
    if action == "clearCache":
        return clear_cache(paths, request.get("id"))
    raise ValueError("Unknown settings action")


if __name__ == "__main__":
    if os.name != "nt":
        parent = os.getppid()
        def watch_parent():
            while True:
                time.sleep(0.5)
                if os.getppid() != parent:
                    os._exit(1)
        threading.Thread(target=watch_parent, daemon=True).start()
    try:
        request = json.loads(sys.stdin.buffer.readline(2_000_001))
        result = dispatch(request, Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]) if len(sys.argv) > 3 else None)
        print(json.dumps({"result": result}, ensure_ascii=False))
    except Exception as error:
        # Generic unexpected failures must not echo request content or keys.
        print(json.dumps({"error": str(error) if isinstance(error, ValueError) else "Settings operation failed"}))
        sys.exit(1)
