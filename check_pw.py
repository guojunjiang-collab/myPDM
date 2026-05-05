import bcrypt
# 验证现有哈希
old_hash = "$2b$12$MwgiArsPySEydYloZq.FYu7lixhRufdvZfqC17I2bW4Eo5kRt0Kp2"
result = bcrypt.checkpw(b"admin123", old_hash.encode())
print(f"old hash valid: {result}")

# 生成新的哈希
new_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()
print(f"new hash: {new_hash}")
