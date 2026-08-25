"""Verified, device-aware Practical-RIFE runtime boundary.

The adapter intentionally reports ``unconfigured`` until a maintainer supplies
an upstream MIT-compatible artifact and SHA-256 in ``models.manifest.json``.
This prevents the server from treating an arbitrary .pkl as a working RIFE
model or silently falling back to another backend.
"""
from .manifest import get_manifest_model, manifest_status
from .adapter import get_rife_capabilities, prepare_rife, validate_rife_request

__all__ = ["get_manifest_model", "manifest_status", "get_rife_capabilities", "prepare_rife", "validate_rife_request"]
