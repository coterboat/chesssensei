#!/usr/bin/env python3
"""Turn Ludo candidates (assets-src/) into shippable files in <target>/public.

    python3 tools/install_assets.py [target_repo] [--pick move=2 --pick icon=3]

Sounds: decode -> mono 16-bit -> trim leading silence -> cut at the tail's decay (hard cap per
sound) -> short fade-out -> normalise. Generated effects arrive with dead air in front and a long
tail; a move sound has to land within a few ms of the piece or it feels laggy.
Without --pick, the candidate with the fastest attack and tightest body wins (we can't listen).
"""
import array
import json
import pathlib
import subprocess
import sys
import wave

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets-src"
CAPS = {"move": 0.22, "capture": 0.30, "check": 0.32, "castle": 0.42, "promote": 0.9, "game-start": 1.1,
        "game-end": 1.4, "low-time": 0.6, "illegal": 0.18}
RATE = 44100


def decode(path):
    tmp = path.with_suffix(".dec.wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(path), str(tmp)], check=True, capture_output=True)
    with wave.open(str(tmp)) as w:
        a = array.array("h")
        a.frombytes(w.readframes(w.getnframes()))
    tmp.unlink()
    return a


def process(samples, cap):
    peak = max(1, max(abs(s) for s in samples))
    start = next((i for i, s in enumerate(samples) if abs(s) > peak * 0.06), 0)
    start = max(0, start - int(RATE * 0.002))
    body = samples[start:start + int(RATE * cap)]
    # End where the sound has decayed for good (last sample above 2% of peak), then fade.
    last = max((i for i, s in enumerate(body) if abs(s) > peak * 0.02), default=len(body) - 1)
    body = body[:min(len(body), last + int(RATE * 0.02))]
    fade = min(len(body), int(RATE * 0.03))
    out = array.array("h", body)
    for i in range(fade):
        out[len(out) - fade + i] = int(out[len(out) - fade + i] * (1 - i / fade))
    gain = (32767 * 0.7) / max(1, max(abs(s) for s in out))
    return array.array("h", (max(-32767, min(32767, int(s * gain))) for s in out)), start / RATE


def score(samples, lead):
    """Lower is better: late onset and a slow attack both feel laggy."""
    peak = max(1, max(abs(s) for s in samples))
    attack = next((i for i, s in enumerate(samples) if abs(s) > peak * 0.8), len(samples)) / RATE
    return attack * 4 + lead * 0.2 + len(samples) / RATE * 0.1


def main():
    args = sys.argv[1:]
    picks = {}
    while "--pick" in args:
        i = args.index("--pick")
        k, v = args[i + 1].split("=")
        picks[k] = int(v)
        del args[i:i + 2]
    target = pathlib.Path(args[0] if args else SRC.parent).resolve()
    out_dir = target / "public" / "sounds"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}

    for d in sorted((SRC / "sounds").iterdir()):
        if not d.is_dir():
            continue
        cands = []
        for c in sorted(d.glob("cand*.bin")):
            processed, lead = process(decode(c), CAPS.get(d.name, 0.5))
            cands.append((int(c.stem[4:]), processed, lead))
        if not cands:
            continue
        chosen = next((c for c in cands if c[0] == picks.get(d.name)), None) or min(cands, key=lambda c: score(c[1], c[2]))
        with wave.open(str(out_dir / f"{d.name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(chosen[1].tobytes())
        report[d.name] = {"picked": chosen[0], "ms": round(len(chosen[1]) / RATE * 1000), "lead_trimmed_ms": round(chosen[2] * 1000),
                          "all_ms": [round(len(c[1]) / RATE * 1000) for c in cands]}
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
