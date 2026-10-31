"""Line translation. Machine translation (free Google, DeepL, LibreTranslate) or dubbing-aware adaptation by a language
model (Claude, OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral, or a local Ollama / LM Studio)."""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

LANGUAGES = [
    ("tr", "Türkçe"), ("en", "İngilizce"), ("de", "Almanca"), ("fr", "Fransızca"), ("es", "İspanyolca"),
    ("it", "İtalyanca"), ("pt", "Portekizce"), ("ru", "Rusça"), ("ar", "Arapça"), ("az", "Azerice"),
    ("ja", "Japonca"), ("ko", "Korece"), ("zh", "Çince"), ("nl", "Felemenkçe"), ("pl", "Lehçe"),
    ("uk", "Ukraynaca"), ("el", "Yunanca"), ("fa", "Farsça"), ("hi", "Hintçe"), ("sv", "İsveççe"),
]
LANG_NAMES = dict(LANGUAGES)
_ENGLISH_NAMES = {"tr": "Turkish", "en": "English", "de": "German", "fr": "French", "es": "Spanish", "it": "Italian",
                  "pt": "Portuguese", "ru": "Russian", "ar": "Arabic", "az": "Azerbaijani", "ja": "Japanese",
                  "ko": "Korean", "zh": "Chinese", "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian", "el": "Greek",
                  "fa": "Persian", "hi": "Hindi", "sv": "Swedish"}
_GOOGLE_CODES = {"zh": "zh-CN"}

STYLES = {
    "natural": "Doğal dublaj",
    "troll": "Komik / troll",
    "literal": "Birebir çeviri",
}

# kind "mt" = machine translation (ignores the style), "llm" = language model with the dubbing prompt.
PROVIDERS = [
    {"id": "google", "name": "Google Çeviri", "kind": "mt", "note": "Ücretsiz, anahtar gerekmez."},
    {"id": "deepl", "name": "DeepL", "kind": "mt", "needsKey": True, "keyUrl": "https://www.deepl.com/your-account/keys",
     "note": "Ücretsiz planda ayda 500.000 karakter."},
    {"id": "libre", "name": "LibreTranslate", "kind": "mt", "needsUrl": True, "url": "https://libretranslate.com",
     "note": "Açık kaynak. Kendi sunucunda ücretsiz, genel sunucu anahtar ister."},
    {"id": "anthropic", "name": "Claude (Anthropic)", "kind": "llm", "needsKey": True,
     "keyUrl": "https://console.anthropic.com/settings/keys", "note": "Süreye sığan, doğal dublaj metni. Ücretli."},
    {"id": "openai", "name": "OpenAI", "kind": "llm", "needsKey": True, "keyUrl": "https://platform.openai.com/api-keys",
     "base": "https://api.openai.com/v1", "note": "Ücretli."},
    {"id": "gemini", "name": "Google Gemini", "kind": "llm", "needsKey": True, "keyUrl": "https://aistudio.google.com/apikey",
     "note": "Ücretsiz kullanım kotası var."},
    {"id": "groq", "name": "Groq", "kind": "llm", "needsKey": True, "keyUrl": "https://console.groq.com/keys",
     "base": "https://api.groq.com/openai/v1", "note": "Ücretsiz kotası var, çok hızlı."},
    {"id": "openrouter", "name": "OpenRouter", "kind": "llm", "needsKey": True, "keyUrl": "https://openrouter.ai/settings/keys",
     "base": "https://openrouter.ai/api/v1", "note": "Tek anahtarla yüzlerce model; bazıları ücretsiz (:free)."},
    {"id": "deepseek", "name": "DeepSeek", "kind": "llm", "needsKey": True, "keyUrl": "https://platform.deepseek.com/api_keys",
     "base": "https://api.deepseek.com/v1", "note": "Ücretli, ucuz."},
    {"id": "mistral", "name": "Mistral", "kind": "llm", "needsKey": True, "keyUrl": "https://console.mistral.ai/api-keys",
     "base": "https://api.mistral.ai/v1", "note": "Ücretsiz deneme planı var."},
    {"id": "ollama", "name": "Ollama (bu bilgisayar)", "kind": "llm", "local": True, "needsUrl": True,
     "url": "http://127.0.0.1:11434", "note": "Ücretsiz, internetsiz. Önce bir model indir: ollama pull qwen3"},
    {"id": "lmstudio", "name": "LM Studio (bu bilgisayar)", "kind": "llm", "local": True, "needsUrl": True,
     "url": "http://127.0.0.1:1234", "note": "Ücretsiz, internetsiz. LM Studio'da sunucuyu başlat."},
    {"id": "custom", "name": "OpenAI uyumlu sunucu", "kind": "llm", "needsUrl": True,
     "note": "vLLM, LocalAI, Together gibi /v1/chat/completions sunan her şey."},
]
REGISTRY = {p["id"]: p for p in PROVIDERS}
ALIASES = {"claude": "anthropic"}
ANTHROPIC_MODELS = [("claude-opus-5-5", "Claude Opus 5.5"), ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
                    ("claude-haiku-5-5", "Claude Haiku 5.5"), ("claude-fable-5-1", "Claude Fable 5.1")]
ENV_KEYS = {"anthropic": ["ANTHROPIC_API_KEY"], "openai": ["OPENAI_API_KEY"], "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
            "groq": ["GROQ_API_KEY"], "openrouter": ["OPENROUTER_API_KEY"], "deepseek": ["DEEPSEEK_API_KEY"],
            "mistral": ["MISTRAL_API_KEY"], "deepl": ["DEEPL_AUTH_KEY", "DEEPL_API_KEY"]}


class TranslateError(RuntimeError):
    pass


def provider(engine):
    return REGISTRY.get(ALIASES.get(engine, engine)) or REGISTRY["google"]


def provider_config(settings, pid):
    """Saved {key, model, url} of a provider with its default url filled in."""
    cfg = dict((settings.get("providers") or {}).get(pid) or {})
    if not cfg.get("url") and REGISTRY.get(pid, {}).get("url"):
        cfg["url"] = REGISTRY[pid]["url"]
    if pid == "anthropic" and not cfg.get("model"):
        cfg["model"] = ANTHROPIC_MODELS[0][0]
    return cfg


# ---------------------------------------------------------------- http
def _http(url, data=None, headers=None, method=None, timeout=60, name="Sunucu", local=False, retries=3):
    """JSON over urllib with retries on rate limits / server errors and Turkish error messages."""
    body = None
    hdrs = {"User-Agent": "DubKanka", **(headers or {})}
    if data is not None:
        if isinstance(data, (bytes, str)):
            body = data.encode() if isinstance(data, str) else data
        else:
            body = json.dumps(data).encode()
            hdrs.setdefault("Content-Type", "application/json")
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", "replace")
            return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:400]
            except Exception:
                pass
            last = (e.code, detail)
            if e.code in (429, 500, 502, 503, 504, 529) and attempt < retries:
                wait = e.headers.get("Retry-After") if e.headers else None
                time.sleep(min(20.0, float(wait)) if wait and wait.replace(".", "", 1).isdigit() else 1.5 * 2 ** attempt)
                continue
            raise TranslateError(_http_message(name, e.code, detail)) from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            if local:
                raise TranslateError(f"{name} çalışmıyor ya da adres yanlış. Uygulamayı açıp tekrar dene.") from e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise TranslateError(f"{name} sunucusuna bağlanılamadı. İnternet bağlantını kontrol et.") from e
        except json.JSONDecodeError as e:
            raise TranslateError(f"{name} beklenmeyen bir yanıt verdi.") from e
    raise TranslateError(f"{name} yanıt vermedi ({last}).")


def _http_message(name, code, detail):
    low = detail.lower()
    if code in (401, 403):
        return f"{name}: API anahtarı geçersiz ya da bu işleme yetkisi yok."
    if code == 402 or "insufficient" in low or "credit" in low or "billing" in low or "quota" in low:
        return f"{name}: bakiye ya da kota yetersiz."
    if code == 404 or "model" in low and ("not found" in low or "does not exist" in low):
        return f"{name}: model ya da adres bulunamadı. Ayarlar'dan modeli kontrol et."
    if code == 429:
        return f"{name}: çok fazla istek ya da kota doldu, biraz sonra tekrar dene."
    if code >= 500:
        return f"{name} şu an hata veriyor ({code}), biraz sonra tekrar dene."
    msg = ""
    try:
        j = json.loads(detail)
        err = j.get("error") if isinstance(j, dict) else None
        msg = (err.get("message") if isinstance(err, dict) else err) or j.get("message") or ""
    except Exception:
        pass
    return f"{name} isteği reddetti ({code}){': ' + str(msg)[:160] if msg else ''}."


# ---------------------------------------------------------------- machine translation
_GTX = "https://translate.googleapis.com/translate_a/single"


def _google_request(text, src, dst):
    params = urllib.parse.urlencode({"client": "gtx", "sl": _GOOGLE_CODES.get(src, src) if src and src != "auto" else "auto",
                                     "tl": _GOOGLE_CODES.get(dst, dst), "dt": "t"})
    body = urllib.parse.urlencode({"q": text}).encode()
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{_GTX}?{params}", data=body, headers={
                "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            return "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503):
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise TranslateError(f"Google Çeviri'ye ulaşılamadı ({last}). İnternet bağlantını kontrol et ya da biraz sonra "
                         "tekrar dene.")


def _batches(texts, limit=3500, count=None):
    out, cur, size = [], [], 0
    for i, t in enumerate(texts):
        if not t.strip():
            continue
        if cur and (size + len(t) > limit or (count and len(cur) >= count)):
            out.append(cur)
            cur, size = [], 0
        cur.append(i)
        size += len(t) + 1
    if cur:
        out.append(cur)
    return out


def translate_google(texts, src, dst, progress=None):
    """Batch lines with newlines (Google keeps them), fall back to one request per line if counts differ."""
    out = [""] * len(texts)
    flat = [" ".join(t.split()) for t in texts]
    batches = _batches(flat)
    total = max(1, sum(len(b) for b in batches))
    done = 0
    for b in batches:
        res = _google_request("\n".join(flat[i] for i in b), src, dst).split("\n")
        if len(res) == len(b):
            for i, r in zip(b, res):
                out[i] = r.strip()
        else:
            with ThreadPoolExecutor(max_workers=2) as ex:
                for i, r in zip(b, ex.map(lambda i: _google_request(texts[i], src, dst), b)):
                    out[i] = r.strip()
        done += len(b)
        if progress:
            progress(done / total)
    return out


def _deepl_lang(code, target):
    code = (code or "").lower()
    if target:
        return {"en": "EN-US", "pt": "PT-BR", "zh": "ZH-HANS"}.get(code, code.upper())
    return code.upper()


def translate_deepl(texts, src, dst, cfg, progress=None):
    key = (cfg.get("key") or "").strip()
    if not key:
        raise TranslateError("DeepL için Ayarlar'dan bir API anahtarı gir.")
    host = "https://api-free.deepl.com" if key.endswith(":fx") else "https://api.deepl.com"
    out = [""] * len(texts)
    batches = _batches(texts, limit=25000, count=50)
    for n, b in enumerate(batches):
        fields = [("text", texts[i]) for i in b] + [("target_lang", _deepl_lang(dst, True))]
        if src and src != "auto":
            fields.append(("source_lang", _deepl_lang(src, False)))
        data = _http(host + "/v2/translate", urllib.parse.urlencode(fields), name="DeepL",
                     headers={"Authorization": f"DeepL-Auth-Key {key}",
                              "Content-Type": "application/x-www-form-urlencoded"})
        for i, tr in zip(b, data.get("translations") or []):
            out[i] = (tr.get("text") or "").strip()
        if progress:
            progress((n + 1) / len(batches))
    return out


def translate_libre(texts, src, dst, cfg, progress=None):
    url = (cfg.get("url") or REGISTRY["libre"]["url"]).rstrip("/")
    out = [""] * len(texts)
    batches = _batches(texts, limit=4000, count=40)
    for n, b in enumerate(batches):
        body = {"q": [texts[i] for i in b], "source": src if src and src != "auto" else "auto", "target": dst,
                "format": "text"}
        if cfg.get("key"):
            body["api_key"] = cfg["key"]
        data = _http(url + "/translate", body, name="LibreTranslate",
                     local=url.startswith(("http://127.", "http://localhost")))
        res = data.get("translatedText")
        if isinstance(res, list) and len(res) == len(b):
            for i, r in zip(b, res):
                out[i] = (r or "").strip()
        else:  # older servers only take one string
            for i in b:
                one = _http(url + "/translate", {**body, "q": texts[i]}, name="LibreTranslate")
                out[i] = (one.get("translatedText") or "").strip()
        if progress:
            progress((n + 1) / len(batches))
    return out


# ---------------------------------------------------------------- language models
_SYSTEM = """You adapt dialogue for amateur fan dubs that friends record at home and post on TikTok.
You receive the lines of one scene in order, each with an id, the speaker, its spoken duration in seconds and the original text.
Write the dubbed version of every line in the target language.

Rules:
- Each dubbed line must be comfortably speakable in about the same time as the original: keep a similar syllable count, shorten when needed.
- Keep it natural spoken language (contractions, everyday words) that fits the speaker and the scene; keep names as they are.
- Return every id exactly once, in the same order, and nothing else."""

_STYLE_HINTS = {
    "natural": "Style: a natural, faithful dub - same meaning and emotion, sounds like real people talking.",
    "troll": "Style: comedy parody dub. Keep the scene's situation and each speaker's energy, but rewrite the lines "
             "into absurd, meme-worthy jokes that still match the mouth movements and timing. Playful, not hateful.",
    "literal": "Style: stay as close to the original wording as the timing allows.",
}

_SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "text": {"type": "string"}},
        "required": ["id", "text"], "additionalProperties": False}}},
    "required": ["lines"], "additionalProperties": False,
}
_JSON_REMINDER = 'Answer with JSON only: {"lines": [{"id": "...", "text": "..."}, ...]}'


def _prompt(part, src, dst, style):
    src_name = _ENGLISH_NAMES.get(src, "the detected language") if src and src != "auto" else "the detected language"
    return (f"Source language: {src_name}. Target language: {_ENGLISH_NAMES.get(dst, dst)}.\n"
            f"{_STYLE_HINTS.get(style, _STYLE_HINTS['natural'])}\n\nLines (JSON):\n" + json.dumps(part, ensure_ascii=False))


def parse_lines_json(text):
    """{id: text} from a model answer: tolerate code fences, chatter around the JSON and a bare list."""
    t = (text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t)
    data = None
    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        for open_c, close_c in (("{", "}"), ("[", "]")):
            a, b = t.find(open_c), t.rfind(close_c)
            if a != -1 and b > a:
                try:
                    data = json.loads(t[a:b + 1])
                    break
                except json.JSONDecodeError:
                    continue
    if isinstance(data, dict):
        data = data.get("lines") if isinstance(data.get("lines"), list) else next(
            (v for v in data.values() if isinstance(v, list)), None)
    if not isinstance(data, list):
        raise TranslateError("Model geçerli JSON döndürmedi.")
    out = {}
    for d in data:
        if isinstance(d, dict) and d.get("id") is not None and isinstance(d.get("text"), str):
            out[str(d["id"])] = d["text"].strip()
    return out


def _openai_chat(p, cfg, prompt):
    base = (cfg.get("url") or p.get("base") or "").rstrip("/")
    if p["id"] in ("ollama", "lmstudio") or (p["id"] == "custom" and not base.endswith("/v1")):
        base = base if base.endswith("/v1") else base + "/v1"
    if not base:
        raise TranslateError(f"{p['name']} için Ayarlar'dan sunucu adresini gir.")
    headers = {}
    if cfg.get("key"):
        headers["Authorization"] = f"Bearer {cfg['key']}"
    elif p.get("needsKey"):
        raise TranslateError(f"{p['name']} için Ayarlar'dan bir API anahtarı gir.")
    model = cfg.get("model") or ""
    if not model:
        raise TranslateError(f"{p['name']} için Ayarlar'dan bir model seç.")
    if p["id"] == "openrouter":
        headers.update({"HTTP-Referer": "https://github.com/unsalable/dubkanka", "X-Title": "DubKanka"})
    body = {"model": model, "messages": [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"}}
    local = bool(p.get("local"))
    try:
        data = _http(base + "/chat/completions", body, headers, name=p["name"], local=local, timeout=600)
    except TranslateError as e:
        if "response_format" not in str(e) and "json" not in str(e).lower() and "(400)" not in str(e):
            raise
        body.pop("response_format")  # servers without JSON mode: the prompt still asks for JSON
        data = _http(base + "/chat/completions", body, headers, name=p["name"], local=local, timeout=600)
    choice = (data.get("choices") or [{}])[0]
    if choice.get("finish_reason") == "content_filter":
        raise TranslateError(f"{p['name']} bu sahneyi çevirmeyi reddetti. Google ile çevirmeyi dene.")
    return ((choice.get("message") or {}).get("content")) or ""


def _gemini(p, cfg, prompt):
    key, model = cfg.get("key") or "", cfg.get("model") or ""
    if not key:
        raise TranslateError("Gemini için Ayarlar'dan bir API anahtarı gir.")
    if not model:
        raise TranslateError("Gemini için Ayarlar'dan bir model seç.")
    schema = {"type": "OBJECT", "properties": {"lines": {"type": "ARRAY", "items": {
        "type": "OBJECT", "properties": {"id": {"type": "STRING"}, "text": {"type": "STRING"}}, "required": ["id", "text"]}}},
        "required": ["lines"]}
    body = {"systemInstruction": {"parts": [{"text": _SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(model)}:generateContent"
    data = _http(url, body, {"x-goog-api-key": key}, name="Gemini", timeout=600)
    cand = (data.get("candidates") or [{}])[0]
    if cand.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST") or data.get("promptFeedback", {}).get("blockReason"):
        raise TranslateError("Gemini bu sahneyi çevirmeyi reddetti. Google ile çevirmeyi dene.")
    return "".join(part.get("text", "") for part in (cand.get("content") or {}).get("parts", []))


def _anthropic(p, cfg, prompt):
    import anthropic

    key = cfg.get("key") or ""
    if not key:
        raise TranslateError("Claude ile çeviri için Ayarlar'dan bir Anthropic API anahtarı gir.")
    model = cfg.get("model") or "claude-opus-5-5"
    client = anthropic.Anthropic(api_key=key, max_retries=3, timeout=600.0)
    kwargs = dict(model=model, max_tokens=16000, system=_SYSTEM, messages=[{"role": "user", "content": prompt}],
                  output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _SCHEMA}})
    try:
        if model.startswith("claude-haiku"):
            resp = client.messages.create(**kwargs)
        else:  # server-side fallback model if the main one declines
            resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
    except anthropic.AuthenticationError as e:
        raise TranslateError("Anthropic API anahtarı geçersiz. Ayarlar'dan kontrol et.") from e
    except anthropic.PermissionDeniedError as e:
        raise TranslateError("Bu API anahtarının seçili modele erişimi yok.") from e
    except anthropic.NotFoundError as e:
        raise TranslateError(f"Model bulunamadı: {model}") from e
    except anthropic.RateLimitError as e:
        raise TranslateError("Claude şu an çok yoğun ya da kotan doldu, biraz sonra tekrar dene.") from e
    except anthropic.BadRequestError as e:
        raise TranslateError(f"Claude isteği reddetti: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise TranslateError(f"Claude hatası ({e.status_code}), biraz sonra tekrar dene.") from e
    except anthropic.APIConnectionError as e:
        raise TranslateError("Claude'a bağlanılamadı. İnternet bağlantını kontrol et.") from e
    if resp.stop_reason == "refusal":
        raise TranslateError("Claude bu sahneyi çevirmeyi reddetti. Google ile çevirmeyi dene.")
    if resp.stop_reason == "max_tokens":
        raise TranslateError("Senaryo çok uzun, Claude yanıtı yarıda kesildi.")
    return next((b.text for b in resp.content if b.type == "text"), "")


def _llm_call(p, cfg, prompt):
    if p["id"] == "anthropic":
        return _anthropic(p, cfg, prompt)
    if p["id"] == "gemini":
        return _gemini(p, cfg, prompt)
    return _openai_chat(p, cfg, prompt)


def translate_llm(p, cfg, items, src, dst, style, progress=None):
    """items: [{id, speaker, seconds, text}] -> {id: dubbed text} (ids the model skipped are missing)."""
    result = {}
    chunk = 120
    for start in range(0, len(items), chunk):
        part = items[start:start + chunk]
        prompt = _prompt(part, src, dst, style)
        try:
            got = parse_lines_json(_llm_call(p, cfg, prompt))
        except TranslateError as e:
            if "JSON" not in str(e):
                raise
            got = parse_lines_json(_llm_call(p, cfg, prompt + "\n\n" + _JSON_REMINDER))  # one stricter retry
        ids = {d["id"] for d in part}
        result.update({k: v for k, v in got.items() if k in ids})
        if progress:
            progress(min(1.0, (start + len(part)) / len(items)))
    return result


# ---------------------------------------------------------------- entry points
def translate_lines(lines, characters, src, dst, engine, style, settings, progress=None, notes=None):
    """Returns {line_id: text}. Same language with machine translation just copies the original. `notes` (a list)
    collects warnings such as lines a model skipped (those fall back to Google)."""
    if not lines:
        return {}
    p = provider(engine)
    cfg = provider_config(settings, p["id"])
    if p["id"] == "anthropic" and not cfg.get("key") and settings.get("anthropicKey"):
        cfg = {"key": settings["anthropicKey"], "model": settings.get("claudeModel") or "claude-opus-5-5"}
    if p["kind"] == "llm":
        names = {c["id"]: c["name"] for c in characters}
        items = [{"id": l["id"], "speaker": names.get(l["char"], "?"), "seconds": round(l["end"] - l["start"], 1),
                  "text": l["orig"]} for l in lines]
        out = translate_llm(p, cfg, items, src, dst, style, progress)
        missing = [l for l in lines if l["id"] not in out and l.get("orig", "").strip()]
        if missing:
            texts = translate_google([l["orig"] for l in missing], src, dst) if src != dst else [l["orig"] for l in missing]
            out.update({l["id"]: t for l, t in zip(missing, texts)})
            if notes is not None:
                notes.append(f"{p['name']} {len(missing)} satırı atladı, onlar Google ile çevrildi.")
        return out
    if src == dst:
        return {l["id"]: l["orig"] for l in lines}
    texts = [l["orig"] for l in lines]
    if p["id"] == "deepl":
        res = translate_deepl(texts, src, dst, cfg, progress)
    elif p["id"] == "libre":
        res = translate_libre(texts, src, dst, cfg, progress)
    else:
        res = translate_google(texts, src, dst, progress)
    return {l["id"]: t for l, t in zip(lines, res)}


def test_provider(pid, cfg):
    """A tiny real translation with unsaved settings; returns the English sample."""
    line = {"id": "1", "char": "c", "start": 0.0, "end": 1.5, "orig": "Merhaba, nasılsın?"}
    out = translate_lines([line], [{"id": "c", "name": "Ali"}], "tr", "en", pid, "natural", {"providers": {pid: cfg}})
    return out.get("1", "")


# ---------------------------------------------------------------- models + auto setup
_SKIP_MODELS = re.compile(r"embed|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|search|guard|vision-only"
                          r"|rerank|ocr|codestral-embed|computer-use", re.I)


def list_models(pid, cfg):
    """[{id, label}] straight from the provider's API."""
    p = REGISTRY.get(ALIASES.get(pid, pid))
    if not p or p["kind"] != "llm":
        return []
    key, local = cfg.get("key") or "", bool(p.get("local"))
    if p["id"] == "anthropic":
        if not key:
            return [{"id": m, "label": label} for m, label in ANTHROPIC_MODELS]
        data = _http("https://api.anthropic.com/v1/models?limit=100", headers={"x-api-key": key,
                     "anthropic-version": "2023-06-01"}, name="Anthropic", timeout=20)
        return [{"id": m["id"], "label": m.get("display_name") or m["id"]} for m in data.get("data", [])]
    if p["id"] == "gemini":
        if not key:
            raise TranslateError("Modelleri görmek için önce Gemini API anahtarını gir.")
        data = _http("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers={"x-goog-api-key": key},
                     name="Gemini", timeout=20)
        return [{"id": m["name"].split("/", 1)[-1], "label": m.get("displayName") or m["name"]}
                for m in data.get("models", []) if "generateContent" in (m.get("supportedGenerationMethods") or [])
                and not _SKIP_MODELS.search(m["name"])]
    if p["id"] == "ollama":
        data = _http((cfg.get("url") or p["url"]).rstrip("/") + "/api/tags", name=p["name"], local=True, timeout=5,
                     retries=0)
        return [{"id": m["name"], "label": m["name"]} for m in data.get("models", []) if not _SKIP_MODELS.search(m["name"])]
    base = (cfg.get("url") or p.get("base") or "").rstrip("/")
    if p["id"] in ("lmstudio", "custom") and base and not base.endswith("/v1"):
        base += "/v1"
    if not base:
        raise TranslateError(f"{p['name']} için önce sunucu adresini gir.")
    if p.get("needsKey") and not key and p["id"] != "openrouter":
        raise TranslateError(f"Modelleri görmek için önce {p['name']} API anahtarını gir.")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    data = _http(base + "/models", headers=headers, name=p["name"], local=local, timeout=20, retries=1 if local else 2)
    models = [{"id": m["id"], "label": m.get("name") or m["id"]} for m in data.get("data", [])
              if m.get("id") and not _SKIP_MODELS.search(m["id"])]
    return sorted(models, key=lambda m: m["id"])


def _version(model_id):
    nums = re.findall(r"(\d+(?:\.\d+)?)", model_id)
    return max((float(n) for n in nums if float(n) < 100), default=0.0)


def pick_model(pid, models):
    """A sensible default: the newest general chat model of the provider (cheap-and-fast flavours for free tiers)."""
    ids = [m["id"] for m in models]
    if not ids:
        return ""
    if pid == "anthropic":
        return "claude-opus-5-5" if "claude-opus-5-5" in ids or len(ids) == len(ANTHROPIC_MODELS) else ids[0]
    prefer = {"openai": r"^gpt-\d", "gemini": r"flash", "groq": r"llama|qwen|gpt-oss", "openrouter": r":free$",
              "deepseek": r"chat", "mistral": r"large|medium"}.get(pid)
    avoid = re.compile(r"mini|nano|lite|preview|exp|tts|audio|instruct-?\d*b?$|-\d{4}-\d{2}-\d{2}$", re.I)
    pool = [i for i in ids if not prefer or re.search(prefer, i, re.I)] or ids
    good = [i for i in pool if not avoid.search(i)] or pool
    return max(good, key=lambda i: (_version(i), -len(i)))


def detect():
    """What can be set up without typing: local model servers that are running, API keys in environment variables."""
    found = []
    for pid in ("ollama", "lmstudio"):
        try:
            models = list_models(pid, {})
            found.append({"id": pid, "source": "local",
                          "detail": f"{len(models)} model" if models else "çalışıyor ama hiç model yok"})
        except TranslateError:
            pass
    for pid, names in ENV_KEYS.items():
        var = next((n for n in names if os.environ.get(n, "").strip()), None)
        if var:
            found.append({"id": pid, "source": "env", "detail": f"ortam değişkeni {var}"})
    return found


def detected_config(pid):
    """Settings for a provider found by detect(): env key or local url, plus a default model when one is listable."""
    p = REGISTRY[pid]
    cfg = {}
    if p.get("local"):
        cfg["url"] = p["url"]
    else:
        var = next((n for n in ENV_KEYS.get(pid, []) if os.environ.get(n, "").strip()), None)
        if not var:
            return None
        cfg["key"] = os.environ[var].strip()
    try:
        model = pick_model(pid, list_models(pid, cfg))
        if model:
            cfg["model"] = model
    except TranslateError:
        pass
    return cfg


def registry_status(settings):
    """The provider list for the UI, with what is configured (never the keys themselves)."""
    out = []
    for p in PROVIDERS:
        cfg = provider_config(settings, p["id"])
        saved = (settings.get("providers") or {}).get(p["id"]) or {}
        configured = p["id"] == "google" or (
            (not p.get("needsKey") or bool(cfg.get("key"))) and (not p.get("needsUrl") or bool(cfg.get("url")))
            and (p["kind"] == "mt" or bool(cfg.get("model"))))
        if p["id"] == "libre":  # the public default server wants a key: only count it once something was set up
            configured = bool(saved.get("url") or saved.get("key"))
        out.append({"id": p["id"], "name": p["name"], "kind": p["kind"], "local": bool(p.get("local")),
                    "needsKey": bool(p.get("needsKey")), "needsUrl": bool(p.get("needsUrl")), "keyUrl": p.get("keyUrl"),
                    "note": p.get("note", ""), "configured": configured, "hasKey": bool(cfg.get("key")),
                    "model": cfg.get("model") or "", "url": cfg.get("url") or ""})
    return out


def system_info():
    from .config import load_settings
    return {"languages": LANGUAGES, "styles": STYLES, "translators": registry_status(load_settings())}
