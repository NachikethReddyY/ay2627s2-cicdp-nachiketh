# LearnQuest
This is a project.

## AI path builder (inference engine)

The "Learn anything" builder calls the Python engine in `services/engine`, which talks to any OpenAI-compatible model. Set `LLM_MODEL`, `LLM_API_BASE` and `LLM_API_KEY` in `services/engine/.env`, then:

```bash
cp services/engine/.env.example services/engine/.env
cd services/engine && uv run uvicorn learnquest_engine.server:app --reload
```

Set `ENGINE_URL` and `ENGINE_TOKEN` (the same token as the engine) in `apps/api/.env`. See [services/engine/README.md](services/engine/README.md).
