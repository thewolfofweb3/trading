# Crypto Research Lab

Dense crypto strategy research shell with structured strategy specs, deterministic mock backtesting, and OpenRouter-ready AI orchestration.

## Run

```bash
npm run dev
```

Open the forwarded port, usually `8000`.

## Optional AI configuration

```bash
OPENROUTER_API_KEY=... OPENROUTER_MODEL=openai/gpt-4.1-mini npm run dev
```

If `OPENROUTER_API_KEY` is absent, the app uses a deterministic local strategy-spec generator. Live execution is intentionally disabled.
