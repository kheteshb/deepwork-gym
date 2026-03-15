import certifi
from pymongo import MongoClient

from .settings import settings

# MongoDB connection string with TLS enabled.
MONGODB_STRING = settings.MONGODB_URL

# Same pattern as working Motor setup: certifi + tlsAllowInvalidCertificates.
client = MongoClient(
    MONGODB_STRING,
    tlsCAFile=certifi.where(),
    tlsAllowInvalidCertificates=True,
)

# Access the database and collections.
database = client["cosmicq"]
users_col = database["users"]
plans_col = database["plans"]
reviews_col = database["reviews"]
sessions_col = database["sessions"]


def test_connection():
    """Test if the MongoDB connection is working."""
    try:
        client.admin.command("ping")
        print("✅ Connected to MongoDB Atlas")
    except Exception as error:
        print("❌ Failed to connect to MongoDB:", error)


if __name__ == "__main__":
    test_connection()
