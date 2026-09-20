#!/usr/bin/env python3
"""Generate Chess Sensei's sounds and icon with Ludo.ai. Candidates land in assets-src/ (gitignored);
`tools/install_assets.py` trims/picks them into public/.

    set -a; source .env.local; set +a
    python3 tools/gen_assets.py            # everything missing
    python3 tools/gen_assets.py move icon  # just these

Client and its lessons (async jobs, lying extensions, 7-day URLs) come from the EO7 pipeline.
"""
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ludo_client as lc  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets-src"
CANDIDATES = 3

WOOD = "Close-mic, dry, no reverb, no music, no voice. Single short sound."
SOUNDS = {
    "move": f"A wooden chess piece placed firmly on a wooden chess board: one soft, low wooden tock. {WOOD}",
    "capture": f"A wooden chess piece knocking into another wooden piece and landing on the board: a sharper double wooden clack. {WOOD}",
    "check": f"A wooden chess piece slammed down hard on a wooden board with emphasis: one loud, crisp wooden knock. {WOOD}",
    "castle": f"Two wooden chess pieces set down on a wooden board in quick succession: tock-tock. {WOOD}",
    "promote": f"A wooden chess piece placed on a board followed by a small bright positive chime. Dry, short.",
    "game-start": "A soft, short two-note rising notification chime, warm marimba tone, calm and minimal. Under one second.",
    "game-end": "A soft, short three-note resolving notification chime, warm marimba tone, calm and final. About one second.",
    "low-time": "A single short quiet clock tick-tock warning, mechanical wooden metronome tick. Dry, under half a second.",
    "illegal": "A very short, quiet, dull muted thud, like tapping a wooden table with a fingertip. Dry.",
}

ICON = (
    "App icon for a chess training app: a bold white chess knight silhouette, facing left, centered on a "
    "deep charcoal rounded-square background with a subtle teal (#5fb3a1) glow behind the knight. Flat vector "
    "style, minimal, high contrast, clean edges, no text, no letters, no border, readable at 32 pixels."
)


def sound(name):
    for i in range(1, CANDIDATES + 1):
        dest = OUT / "sounds" / name / f"cand{i:02d}.bin"
        if dest.exists():
            continue
        try:
            payload = lc.generate("createSoundEffect", {"description": SOUNDS[name], "duration": 1, "loop": False})
            lc.download(lc.first_url(payload), dest)
            print(f"  sound {name} {i}/{CANDIDATES} ok", flush=True)
        except lc.LudoError as exc:
            print(f"  sound {name} {i} FAILED: {exc}", flush=True)


def icon(_name="icon"):
    for i in range(1, CANDIDATES + 1):
        dest = OUT / "icon" / f"cand{i:02d}.bin"
        if dest.exists():
            continue
        try:
            payload = lc.generate("createImage", {"prompt": ICON, "image_type": "item-icon"})
            lc.download(lc.first_url(payload), dest)
            print(f"  icon {i}/{CANDIDATES} ok", flush=True)
        except lc.LudoError as exc:
            print(f"  icon {i} FAILED: {exc}", flush=True)


def main():
    want = sys.argv[1:] or [*SOUNDS, "icon"]
    jobs = [(icon if w == "icon" else sound, w) for w in want]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda j: j[0](j[1]), jobs))
    print(json.dumps({p.parent.name: len(list(p.parent.glob('cand*'))) for p in OUT.rglob('cand01.bin')}, indent=1))


if __name__ == "__main__":
    main()
