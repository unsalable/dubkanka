"""Turn word timestamps + speaker turns into dubbing lines (one speaker, one breath each)."""
import re

from .projects import add_character, new_id

SENTENCE_END = re.compile(r"[.!?…]+[\"'”’)\]]*$")


def _speaker_for(w, turns):
    best, best_ov = None, 0.0
    for s, e, spk in turns:
        if s > w["end"]:
            break
        ov = min(e, w["end"]) - max(s, w["start"])
        if ov > best_ov:
            best, best_ov = spk, ov
    if best is None and turns:
        mid = (w["start"] + w["end"]) / 2
        near = min(turns, key=lambda t: 0.0 if t[0] <= mid <= t[1] else min(abs(mid - t[0]), abs(mid - t[1])))
        best = near[2]
    return 0 if best is None else best


def assign_speakers(words, turns):
    turns = sorted(turns)
    for w in words:
        w["spk"] = _speaker_for(w, turns)
    # A lone short word flipping speaker between two words of the same speaker is almost always noise.
    for i in range(1, len(words) - 1):
        a, w, b = words[i - 1], words[i], words[i + 1]
        if (a["spk"] == b["spk"] != w["spk"] and w["end"] - w["start"] < 0.45
                and w["start"] - a["end"] < 0.3 and b["start"] - w["end"] < 0.3):
            w["spk"] = a["spk"]
    # Speaker turns from diarization are a bit blurry at hand-overs; a sentence rarely changes speaker,
    # so a short minority part of a sentence follows the sentence's main speaker.
    sentence = []
    for i, w in enumerate(words):
        sentence.append(w)
        last = i == len(words) - 1
        if last or SENTENCE_END.search(w["text"].strip()) or words[i + 1]["start"] - w["end"] > 1.0:
            share = {}
            for x in sentence:
                share[x["spk"]] = share.get(x["spk"], 0.0) + (x["end"] - x["start"])
            if len(share) > 1:
                main = max(share, key=share.get)
                if sum(v for k, v in share.items() if k != main) < 1.2:
                    for x in sentence:
                        x["spk"] = main
            sentence = []
    return words


def build_lines(words, gap_split=0.7, soft_max=6.0, hard_max=10.0):
    groups, cur = [], None
    for w in words:
        if cur is not None:
            gap = w["start"] - cur["end"]
            dur = w["end"] - cur["start"]
            sentence_end = bool(SENTENCE_END.search(cur["words"][-1]["text"].strip()))
            if (w["spk"] != cur["spk"] or gap > gap_split or (sentence_end and gap > 0.3)
                    or (sentence_end and dur > soft_max) or dur > hard_max):
                groups.append(cur)
                cur = None
        if cur is None:
            cur = {"start": w["start"], "end": w["end"], "spk": w["spk"], "words": []}
        cur["words"].append(w)
        cur["end"] = max(cur["end"], w["end"])
    if cur:
        groups.append(cur)
    return groups


def refine_bounds(groups, regions):
    """Snap line edges to real voice activity of the dialogue stem (Whisper timings drift ~0.1-0.3 s)."""
    for i, g in enumerate(groups):
        prev_end = groups[i - 1]["end"] if i else 0.0
        next_start = groups[i + 1]["start"] if i + 1 < len(groups) else float("inf")
        starts = [s for s, e in regions if g["start"] - 0.35 <= s <= g["start"] + 0.15 and s >= prev_end - 0.05]
        if starts:
            g["start"] = min(starts)
        ends = [e for s, e in regions if g["end"] - 0.15 <= e <= g["end"] + 0.35 and e <= next_start + 0.05]
        if ends:
            g["end"] = max(ends)
        if g["end"] - g["start"] < 0.25:
            g["end"] = g["start"] + 0.25
    return groups


def make_project_lines(p, words, turns, regions):
    """Fill p['characters'] / p['lines'] from transcription results. Returns number of lines."""
    words = assign_speakers([dict(w) for w in words], turns)
    groups = refine_bounds(build_lines(words), regions)
    order = []
    for g in groups:
        if g["spk"] not in order:
            order.append(g["spk"])
    p["characters"] = []
    spk_to_char = {}
    for spk in order:
        spk_to_char[spk] = add_character(p)["id"]
    if not p["characters"]:
        add_character(p)
    p["lines"] = []
    for g in groups:
        text = re.sub(r"\s+", " ", "".join(w["text"] for w in g["words"])).strip()
        if not text:
            continue
        p["lines"].append({
            "id": new_id("l", 7),
            "start": round(g["start"], 3),
            "end": round(g["end"], 3),
            "char": spk_to_char.get(g["spk"], p["characters"][0]["id"]),
            "orig": text,
            "text": "",
            "words": [[round(w["start"], 3), round(w["end"], 3), w["text"]] for w in g["words"]],
            "takes": [],
            "take": None,
        })
    return len(p["lines"])
