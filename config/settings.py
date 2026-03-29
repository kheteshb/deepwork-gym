import os
from types import SimpleNamespace

from dotenv import load_dotenv

load_dotenv()

# MongoDB connection URL (from .env or environment).
MONGODB_URL = os.environ.get(
    "MONGODB_URI",
    os.environ.get("MONGODB_URL"),
)

settings = SimpleNamespace(MONGODB_URL=MONGODB_URL)
