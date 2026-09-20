#!/usr/bin/env python3
"""
Thin client for the Ludo.ai MCP endpoint.

Why this exists
---------------
Ludo is already how this project's character art gets made - the Max sheets are
6x6/36-frame Ludo output, and `key_background_alpha.py` exists because of Ludo's
opaque-background failure. This module makes that pipeline scriptable so a whole
animation set can be generated, judged and re-run without hand-driving a web UI.

Transport
---------
The MCP endpoint speaks JSON-RPC over HTTPS. Every generation tool takes a single
`requestBody` object. Tool results come back as text that is prefixed with
`API Response (Status: NNN):` before the actual JSON, and the payload is
sometimes an object and sometimes an array - `call()` normalises all of that.

Two things that will bite you if you forget them:

1. **Asset URLs expire after 7 days.** The server says so in its own handshake
   instructions. Download immediately; never store a returned URL as a reference.
2. **There is no negative-prompt parameter.** Text appended to the prompt is read
   as things to *draw*. Feeding this project's NEGATIVE block to `createImage`
   reliably produces a painted transparency checkerboard - the exact failure that
   block exists to prevent. See `ludo_prompt.py`.
"""

import base64
import http.client
import json
import mimetypes
import os
import pathlib
import time
import urllib.error
import urllib.request

MCP_URL = os.environ.get("LUDO_MCP_URL", "https://mcp.ludo.ai/mcp")
_RESPONSE_PREFIX = "API Response (Status:"


class LudoError(RuntimeError):
    """A tool call failed, or returned something we cannot parse."""


def api_key():
    key = os.environ.get("LUDO_API_KEY", "").strip()
    if not key:
        raise LudoError(
            "LUDO_API_KEY is not set. Export it (do not commit it):\n"
            "    export LUDO_API_KEY=...")
    return key


def _parse_tool_text(text):
    """Pull the JSON payload out of a tool result's text block.

    Format is `API Response (Status: 200):\\n{...}` or `...\\n[...]`. A non-2xx
    status is raised rather than returned, so callers never see a partial result.
    """
    if text.startswith(_RESPONSE_PREFIX):
        head, _, rest = text.partition(":\n")
        status = "".join(c for c in head if c.isdigit())
        if status and not status.startswith("2"):
            raise LudoError(f"HTTP {status}: {rest[:400]}")
        text = rest
        # 204 No Content is a success with an empty body - validateApiKeyEndpoint
        # answers this way. Returning None beats raising "no JSON".
        if not text.strip():
            return None
    start = min((i for i in (text.find("{"), text.find("[")) if i != -1),
                default=-1)
    if start == -1:
        raise LudoError(f"no JSON in tool result: {text[:400]}")
    return json.loads(text[start:])


def call(tool, arguments=None, timeout=300, retries=2):
    """Invoke one MCP tool and return its decoded payload.

    Generation is synchronous - 3D and animation calls can block for 30-120s -
    so `timeout` is generous by default. Transport-level failures are retried;
    a rejection from the API itself is not, because retrying a bad request just
    spends the same credits twice.
    """
    body = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 100000,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments or {}},
    }
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"ApiKey {api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
    )
    last = None
    for attempt in range(retries + 1):
        try:
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
            break
        # OSError covers ssl.SSLError and ConnectionError, which http.client
        # raises RAW rather than wrapped in URLError - a single transient
        # SSL BAD_RECORD_MAC escaped the old (URLError, TimeoutError) net and
        # killed a six-sheet batch on its first request. HTTPException covers
        # the same layer's protocol-level hiccups (RemoteDisconnected etc).
        except (urllib.error.URLError, TimeoutError, OSError,
                http.client.HTTPException) as exc:
            last = exc
            if attempt == retries:
                raise LudoError(f"{tool}: transport failed: {exc}") from exc
            time.sleep(2 ** attempt)
    else:  # pragma: no cover - loop always breaks or raises
        raise LudoError(f"{tool}: {last}")

    envelope = json.loads(raw)
    if "error" in envelope:
        raise LudoError(f"{tool}: {json.dumps(envelope['error'])[:400]}")
    content = envelope.get("result", {}).get("content", [])
    if not content:
        raise LudoError(f"{tool}: empty result")
    return _parse_tool_text(content[0].get("text", ""))


def generate(tool, request_body, poll_timeout=900, **kw):
    """Call a generation tool, which always wraps its payload in `requestBody`,
    and wait for the job it starts.

    The API went asynchronous (2026-08): every generation tool now answers
    `{id, status: "queued", poll_after_ms}` instead of the asset, and the
    asset arrives via `getApiJob` once `status` is `succeeded` — its `result`
    is shaped exactly like the tool's old synchronous payload, so callers
    above this line see no change. `wait: 30` long-polls server-side, which
    is one round trip per half-minute instead of a busy loop. A `failed` job
    raises with the server's own error; a job that never settles inside
    `poll_timeout` seconds raises too, rather than hanging a batch.
    """
    payload = call(tool, {"requestBody": request_body}, **kw)
    if not (isinstance(payload, dict) and payload.get("status") in ("queued", "running")):
        return payload
    job_id = payload.get("id")
    if not job_id:
        raise LudoError(f"{tool}: queued with no job id: {json.dumps(payload)[:300]}")
    deadline = time.time() + poll_timeout
    while time.time() < deadline:
        job = call("getApiJob", {"id": job_id, "wait": 30}, timeout=90)
        status = job.get("status") if isinstance(job, dict) else None
        if status == "succeeded":
            return job.get("result", job)
        if status in ("failed", "canceled"):
            raise LudoError(f"{tool}: job {job_id} {status}: "
                            f"{json.dumps(job.get('error'))[:400]}")
        time.sleep(max(0.5, float(job.get("poll_after_ms", 2000)) / 1000.0)
                   if isinstance(job, dict) else 2.0)
    raise LudoError(f"{tool}: job {job_id} did not finish in {poll_timeout}s")


def data_uri(path):
    """Encode a local image as a data URI for `initial_image` / `image` fields.

    The API accepts a URL or base64 and rejects anything over 15MB, which is
    checked here so the failure names the file instead of surfacing as HTTP 400.
    """
    path = pathlib.Path(path)
    raw = path.read_bytes()
    if len(raw) > 15 * 1024 * 1024:
        raise LudoError(f"{path} is {len(raw)/1e6:.1f}MB; the API limit is 15MB")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def download(url, dest):
    """Fetch a generated asset to disk. Do this immediately - URLs die in 7 days."""
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r:
        dest.write_bytes(r.read())
    return dest


def first_url(payload):
    """Generation tools return either `{url}` or `[{url}, ...]`; take the first."""
    if isinstance(payload, list):
        if not payload:
            raise LudoError("empty result array")
        payload = payload[0]
    url = payload.get("url")
    if not url:
        raise LudoError(f"no url in payload: {json.dumps(payload)[:300]}")
    return url
