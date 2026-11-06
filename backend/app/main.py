"""Generic API starter. No application or sponsor-specific behavior."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    frontend_origin: str = "http://127.0.0.1:5174"
    evm_rpc_url: str = "http://127.0.0.1:8545"


settings = Settings()
app = FastAPI(title="Hackathon API base", version="0.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
