"""Optional LLM layer.

Auto-detects a provider from whichever free-tier key is present. Every caller
must tolerate `None` -- the pipeline is fully functional without any LLM, and
`available()` is the single place that decides.
"""
from __future__ import annotations

import json
import re

import requests

import config

_PROVIDER: str | None = None
if config.GROQ_API_KEY:
    _PROVIDER = "groq"
elif config.GEMINI_API_KEY:
    _PROVIDER = "gemini"
elif config.OPENROUTER_API_KEY:
    _PROVIDER = "openrouter"


def available() -> bool:
    return _PROVIDER is not None


def provider_name() -> str:
    return _PROVIDER or "none (deterministic rules)"


def complete(prompt: str, system: str = "", max_tokens: int = 900,
             temperature: float = 0.2) -> str | None:
    if not _PROVIDER:
        return None
    try:
        if _PROVIDER == "groq":
            return _openai_style(
                "https://api.groq.com/openai/v1/chat/completions",
                config.GROQ_API_KEY, config.GROQ_MODEL,
                prompt, system, max_tokens, temperature,
            )
        if _PROVIDER == "openrouter":
            return _openai_style(
                "https://openrouter.ai/api/v1/chat/completions",
                config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL,
                prompt, system, max_tokens, temperature,
            )
        return _gemini(prompt, system, max_tokens, temperature)
    except Exception as exc:  # noqa: BLE001 - LLM is strictly best-effort
        print(f"[llm] {_PROVIDER} call failed: {exc}")
        return None


def _openai_style(url, key, model, prompt, system, max_tokens, temperature):
    messages = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt}]
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages,
              "max_tokens": max_tokens, "temperature": temperature},
        timeout=config.HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def _gemini(prompt, system, max_tokens, temperature):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{config.GEMINI_MODEL}:generateContent")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    resp = requests.post(url, params={"key": config.GEMINI_API_KEY}, json=body,
                         timeout=config.HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


def complete_json(prompt: str, system: str = "", max_tokens: int = 900):
    """Models wrap JSON in prose or fences often enough to be worth handling."""
    raw = complete(prompt, system, max_tokens, temperature=0.1)
    if not raw:
        return None
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"[\[{].*[\]}]", raw, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
