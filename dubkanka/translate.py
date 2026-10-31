"""Line translation: free Google Translate, or dubbing-aware adaptation with Claude."""
import json
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
_GOOGLE_CODES = {"zh": "zh-CN"}

STYLES = {
    "natural": "Doğal dublaj",
    "troll": "Komik / troll",
    "literal": "Birebir çeviri",
}


class TranslateError(RuntimeError):
    pass


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


def translate_google(texts, src, dst, progress=None):
    """Batch lines with newlines (Google keeps them), fall back to one request per line if counts differ."""
    out = [""] * len(texts)
    idx = [i for i, t in enumerate(texts) if t.strip()]
    batches, cur, size = [], [], 0
    for i in idx:
        t = " ".join(texts[i].split())
        if cur and size + len(t) > 3500:
            batches.append(cur)
            cur, size = [], 0
        cur.append(i)
        size += len(t) + 1
    if cur:
        batches.append(cur)
    done = 0
    for b in batches:
        res = _google_request("\n".join(" ".join(texts[i].split()) for i in b), src, dst).split("\n")
        if len(res) == len(b):
            for i, r in zip(b, res):
                out[i] = r.strip()
        else:
            with ThreadPoolExecutor(max_workers=2) as ex:
                for i, r in zip(b, ex.map(lambda i: _google_request(texts[i], src, dst), b)):
                    out[i] = r.strip()
        done += len(b)
        if progress:
            progress(done / max(1, len(idx)))
    return out


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


def translate_claude(items, src, dst, style, api_key, model, progress=None):
    """items: [{id, speaker, seconds, text}] -> {id: dubbed text}"""
    import anthropic

    if not api_key:
        raise TranslateError("Claude ile çeviri için Ayarlar'dan bir Anthropic API anahtarı gir.")
    client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=600.0)
    schema = {
        "type": "object",
        "properties": {"lines": {"type": "array", "items": {
            "type": "object",
            "properties": {"id": {"type": "string"}, "text": {"type": "string"}},
            "required": ["id", "text"], "additionalProperties": False}}},
        "required": ["lines"], "additionalProperties": False,
    }
    src_name = LANG_NAMES.get(src, "the detected language") if src and src != "auto" else "the detected language"
    dst_name = {"tr": "Turkish", "en": "English", "de": "German", "fr": "French", "es": "Spanish", "it": "Italian",
                "pt": "Portuguese", "ru": "Russian", "ar": "Arabic", "az": "Azerbaijani", "ja": "Japanese",
                "ko": "Korean", "zh": "Chinese", "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian", "el": "Greek",
                "fa": "Persian", "hi": "Hindi", "sv": "Swedish"}.get(dst, dst)
    result = {}
    chunk = 120
    for start in range(0, len(items), chunk):
        part = items[start:start + chunk]
        prompt = (f"Source language: {src_name}. Target language: {dst_name}.\n{_STYLE_HINTS.get(style, _STYLE_HINTS['natural'])}\n\n"
                  "Lines (JSON):\n" + json.dumps(part, ensure_ascii=False))
        kwargs = dict(model=model, max_tokens=16000, system=_SYSTEM,
                      messages=[{"role": "user", "content": prompt}],
                      output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}})
        try:
            if model.startswith("claude-haiku"):
                resp = client.messages.create(**kwargs)
            else:  # server-side fallback model if the main one declines
                resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                                                   **kwargs)
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
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise TranslateError("Claude'dan beklenmeyen yanıt geldi, tekrar dene.") from e
        for d in data.get("lines", []):
            result[d["id"]] = d["text"].strip()
        if progress:
            progress(min(1.0, (start + len(part)) / len(items)))
    return result


def translate_lines(lines, characters, src, dst, engine, style, settings, progress=None):
    """Returns {line_id: text}. Same-language + google just copies the original."""
    if not lines:
        return {}
    if engine == "claude":
        names = {c["id"]: c["name"] for c in characters}
        items = [{"id": l["id"], "speaker": names.get(l["char"], "?"), "seconds": round(l["end"] - l["start"], 1),
                  "text": l["orig"]} for l in lines]
        return translate_claude(items, src, dst, style, settings.get("anthropicKey", ""),
                                settings.get("claudeModel") or "claude-opus-5-5", progress)
    if src == dst:
        return {l["id"]: l["orig"] for l in lines}
    texts = translate_google([l["orig"] for l in lines], src, dst, progress)
    return {l["id"]: t for l, t in zip(lines, texts)}


def system_info():
    return {"languages": LANGUAGES, "styles": STYLES}
