"""Turkish and English for what the server says: job steps and messages, errors, feature, preset and language names.

The code is written in Turkish; tx("…") looks that text up in EN when the language is English (like gettext), so a
missing entry still reads as Turkish. The language is the one of the request (the X-DK-Lang header the web UI sends
with every call), of the request that started a background job (jobs.py runs each job in a copy of that context), else
the app setting. `{name}` marks a value; an English entry can be (one, other) for a count passed as `n`. Text keyed
"ctx|…" carries a context for a word with two English ones; Turkish shows it without the context.
"""
import contextvars

from .lang_en import EN

LANGS = ("tr", "en")
_lang = contextvars.ContextVar("dk_lang", default=None)


def current():
    lang = _lang.get()
    if lang:
        return lang
    from .config import load_settings
    return load_settings().get("language") or "tr"


def use(lang):
    """Make `lang` the language of this context (a request, a job); returns the token for reset()."""
    return _lang.set(lang if lang in LANGS else None)


def reset(token):
    _lang.reset(token)


def _bare(text):
    i = text.find("|")
    return text[i + 1:] if 0 < i < 8 else text


def tx(text, **kw):
    out = EN.get(text, _bare(text)) if current() == "en" else _bare(text)
    if isinstance(out, tuple):
        out = out[0 if kw.get("n") == 1 else 1]
    return out.format(**kw) if kw else out


class LangMiddleware:
    """Every request speaks the language its page asked for (pure ASGI, so the endpoint sees the context too)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        lang = dict(scope.get("headers") or []).get(b"x-dk-lang", b"").decode("ascii", "ignore")
        token = use(lang)
        try:
            await self.app(scope, receive, send)
        finally:
            reset(token)
