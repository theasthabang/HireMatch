"""
Cloudflare R2 storage.

IMPORTANT — this module never talks to AWS in any way. There is no AWS
account, no AWS IAM credentials, and no AWS S3 bucket involved anywhere
here. boto3 is used purely as an HTTP client library that happens to speak
the S3 API — Cloudflare R2 deliberately implements that same API surface
so existing S3-shaped tooling (boto3 included) works against it once
pointed at R2's own endpoint and authenticated with R2's own credentials.
Three things in _get_r2_client() below are what actually make every
request in this file go to Cloudflare, not Amazon — see that function's
docstring.

R2-vs-real-S3 API differences this module explicitly accounts for:
  - R2 uses a single endpoint per account (https://<account_id>.r2.cloudflarestorage.com)
    instead of AWS's per-region endpoints, and has no real concept of
    regions — "auto" is the literal value Cloudflare's own docs specify
    for region_name.
  - R2 has a documented history of rejecting the checksum headers newer
    boto3/botocore versions attach to requests by default (AWS rolled out
    default CRC32 checksums across its SDKs in Jan 2025, which broke
    uploads against R2 and other S3-compatible services until fixed
    server-side — see https://community.cloudflare.com/t/759067). The
    checksum Config options below are a defensive measure against that
    whole class of version-drift breakage, not a currently-required
    workaround — harmless if R2 already handles it, protective if a
    future botocore bump reintroduces the issue.
Verified against boto3 1.43.90 / botocore 1.43.90 (current as of this
module being written) using a local S3-API-compatible test server — see
test_r2_storage.py for the actual request/response trace, including a
signature-tampering test confirming presigned URLs are cryptographically
enforced, not just obscure.
"""

import os
import uuid
import logging
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# From your Cloudflare dashboard: R2 > Manage API Tokens > Create API Token.
# Never AWS IAM — these are R2-specific credential values that only work
# against your R2 account.
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

# The ONE line that sends every request in this module to Cloudflare
# instead of AWS's actual S3 endpoints — boto3's default behavior without
# an explicit endpoint_url is to talk to real AWS.
R2_ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else None

PRESIGNED_URL_EXPIRY_SECONDS = int(os.getenv("R2_PRESIGNED_URL_EXPIRY_SECONDS", "900"))  # 15 minutes

if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
    logger.warning(
        "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME are not fully "
        "set. Every function in this module will fail until all four are configured, from your "
        "Cloudflare dashboard — not AWS."
    )

_r2_client = None


def _get_r2_client():
    """
    Lazily builds and caches a single boto3 S3-API client. Despite using
    boto3.client("s3") — the same call you'd use for real AWS S3 — three
    things here make every request this client sends go to Cloudflare R2,
    authenticated as your R2 account, never AWS:

      1. endpoint_url=R2_ENDPOINT_URL — explicitly redirects every request
         to https://<account_id>.r2.cloudflarestorage.com. This is the
         entire mechanism; without it, boto3 defaults to AWS's real S3
         endpoints and this would in fact be talking to AWS.
      2. aws_access_key_id / aws_secret_access_key are R2 API token values
         from the Cloudflare dashboard — boto3 names these parameters
         "aws_*" purely because it's an AWS-authored library, not because
         AWS is involved. R2 accepts credentials shaped the same way (and
         signed the same way, SigV4) as AWS's, which is what "S3-compatible"
         means here.
      3. region_name="auto" — R2 has no AWS-style regions; "auto" is the
         literal value Cloudflare's own docs specify. boto3's SigV4 signing
         requires *some* region_name to be present, so this satisfies that
         requirement without implying a real AWS region.

    The Config options (request_checksum_calculation / response_checksum_
    validation, both "when_required") are a defensive measure against a
    documented class of breakage: AWS's SDKs started attaching CRC32
    checksum headers to requests by default in Jan 2025, which R2 (and
    several other S3-compatible providers) rejected with errors like
    "Header 'x-amz-checksum-algorithm' with value 'CRC32' not implemented"
    until fixed server-side. Setting these explicitly keeps this client
    on the older, universally-compatible behavior regardless of which
    botocore version ends up installed.
    """
    global _r2_client
    if _r2_client is None:
        if not R2_ENDPOINT_URL or not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
            raise RuntimeError(
                "R2 is not configured — R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and "
                "R2_SECRET_ACCESS_KEY must all be set."
            )
        _r2_client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )
    return _r2_client


def upload_resume_to_r2(file_bytes: bytes, user_id, filename: str) -> str:
    """
    Uploads a resume's raw bytes to the R2 bucket and returns the storage
    KEY — never a URL. See this module's caller (main.py's create_resume)
    and the accompanying explanation of why a key, not a public URL, is
    what gets persisted to the database.

    Key structure: resumes/{user_id}/{uuid}_{filename}
      - the user_id prefix keeps each user's files grouped, and makes a
        cross-user key collision structurally impossible.
      - the uuid prefix on the filename prevents two different uploads
        that happen to share a filename (two resumes both named
        "resume.pdf") from overwriting each other — an object store's key
        is an object's entire identity; same key means overwrite.

    :param file_bytes: Raw file content.
    :param user_id: The owning user's id (current_user.id) — stringified
        into the key; works whether that's an int or (as in this app) a UUID.
    :param filename: Original filename, used only for the human-readable
        suffix — basename'd first so a crafted filename can't inject extra
        path segments into the key.
    :return: The storage key, e.g. "resumes/3f9a.../7c1e..._resume.pdf".
    :raises RuntimeError: if R2 isn't configured.
    :raises botocore.exceptions.ClientError: if the upload itself fails —
        deliberately not swallowed here; a caller believing a resume was
        stored when it wasn't is a worse failure than a clear exception.
    """
    client = _get_r2_client()

    safe_filename = os.path.basename(filename or "resume")
    storage_key = f"resumes/{user_id}/{uuid.uuid4()}_{safe_filename}"

    client.put_object(Bucket=R2_BUCKET_NAME, Key=storage_key, Body=file_bytes)
    logger.info(f"Uploaded resume to R2: key={storage_key}, size={len(file_bytes)} bytes")
    return storage_key


def download_resume_from_r2(storage_key: str) -> bytes:
    """
    Downloads a resume's raw bytes back out of R2 by its storage key.

    Used by the upload flow (main.py's create_resume) to re-fetch the
    just-uploaded file for text extraction, rather than parsing from the
    local temp copy of the original upload — R2 is the single source of
    truth for the raw file from the moment upload_resume_to_r2 returns;
    extraction reads from it rather than from wherever the bytes
    incidentally already were.
    """
    client = _get_r2_client()
    try:
        response = client.get_object(Bucket=R2_BUCKET_NAME, Key=storage_key)
        return response["Body"].read()
    except ClientError as e:
        logger.error(f"Failed to download resume from R2 (key={storage_key}): {e}")
        raise


def get_resume_url(storage_key: str, expires_in: int = PRESIGNED_URL_EXPIRY_SECONDS) -> str:
    """
    Generates a presigned URL granting temporary read access to one
    specific object. The bucket itself never needs to be public for this
    to work — the URL's own query string carries a scoped, time-limited
    cryptographic signature; see this conversation's explanation of what
    that signature actually does.

    :param storage_key: The key returned by upload_resume_to_r2().
    :param expires_in: Seconds until the URL stops working. Defaults to
        PRESIGNED_URL_EXPIRY_SECONDS (15 minutes) — long enough for a
        frontend to load or download the file, short enough that a leaked
        URL (browser history, a proxy log, a shared screenshot) isn't a
        standing liability.
    :return: A fully-qualified, time-limited HTTPS URL.
    """
    client = _get_r2_client()
    return client.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": R2_BUCKET_NAME, "Key": storage_key},
        ExpiresIn=expires_in,
    )