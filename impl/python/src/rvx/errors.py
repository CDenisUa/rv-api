"""Exception hierarchy for the RV Exchange reference implementation."""


class RVError(Exception):
    """Base class for all rvx errors."""


class ValidationError(RVError):
    """A document is structurally or semantically invalid."""


class CapabilityError(RVError):
    """An operation was requested that the RV does not support (e.g. log_prob of a
    non-invertible transform)."""


class CapabilityMismatch(ValidationError):
    """Declared capabilities contradict the capabilities recomputed from structure."""


class MomentsNotAvailable(RVError):
    """No closed-form moments are available for this node (use sampling instead)."""


class NotInvertibleError(CapabilityError):
    """The transform op has no inverse, so change-of-variables is undefined."""
