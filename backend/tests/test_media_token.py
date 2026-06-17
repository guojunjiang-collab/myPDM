import pytest
from fastapi import HTTPException
from app.media_token import mint_media_token, verify_media_token


def test_media_token_roundtrip():
    t = mint_media_token("att-1", "preview", ttl=300)
    assert verify_media_token(t, "att-1", "preview") is True


def test_media_token_wrong_action():
    t = mint_media_token("att-1", "preview", ttl=300)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-1", "gltf")


def test_media_token_wrong_attachment():
    t = mint_media_token("att-1", "preview", ttl=300)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-2", "preview")


def test_media_token_expired():
    t = mint_media_token("att-1", "preview", ttl=-1)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-1", "preview")


def test_media_token_empty():
    with pytest.raises(HTTPException):
        verify_media_token("", "att-1", "preview")


def test_media_token_missing_typ():
    from jose import jwt
    from app.routers.auth import SECRET_KEY, ALGORITHM
    from datetime import datetime, timedelta
    t = jwt.encode({"aid": "att-1", "act": "preview", "exp": datetime.utcnow() + timedelta(seconds=300)}, SECRET_KEY, algorithm=ALGORITHM)
    with pytest.raises(HTTPException):
        verify_media_token(t, "att-1", "preview")
