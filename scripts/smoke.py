"""Run using backend/.venv/Scripts/python.exe after starting the local services."""

import json
from urllib.request import urlopen

import psycopg
from redis import Redis
from web3 import Web3

with urlopen("http://127.0.0.1:8000/health", timeout=10) as response:
    assert json.load(response) == {"status": "ok"}
print("API health: passed")

web3 = Web3(Web3.HTTPProvider("http://127.0.0.1:8545", request_kwargs={"timeout": 10}))
assert web3.is_connected()
assert web3.eth.chain_id == 31337, (
    "Smoke transactions are restricted to the local chain."
)
sender, recipient = web3.eth.accounts[:2]
before = web3.eth.get_balance(recipient)
transaction = web3.eth.send_transaction({"from": sender, "to": recipient, "value": 1})
receipt = web3.eth.wait_for_transaction_receipt(transaction, timeout=20)
assert receipt["status"] == 1
assert web3.eth.get_balance(recipient) == before + 1
print("Local EVM transfer: passed")

with psycopg.connect(
    "host=127.0.0.1 port=5432 dbname=hackathon user=hackathon", connect_timeout=10
) as connection:
    assert connection.execute("SELECT 1").fetchone() == (1,)
print("PostgreSQL query: passed")

cache = Redis(host="127.0.0.1", port=6379, socket_timeout=10)
assert cache.ping()
assert cache.set("hackathon-base:smoke", "ok", ex=30)
assert cache.get("hackathon-base:smoke") == b"ok"
cache.delete("hackathon-base:smoke")
print("Redis write/read: passed")
