/**
 * Exception hierarchy for the RV Exchange reference implementation.
 * Mirrors the Python reference (rvx.errors) so error semantics are portable.
 */

export class RVError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** A document is structurally or semantically invalid. */
export class ValidationError extends RVError {}

/** An operation was requested that the RV does not support (e.g. log_prob of a
 *  non-invertible transform). */
export class CapabilityError extends RVError {}

/** Declared capabilities contradict the capabilities recomputed from structure. */
export class CapabilityMismatch extends ValidationError {}

/** No closed-form moments are available for this node (use sampling instead). */
export class MomentsNotAvailable extends RVError {}

/** The transform op has no inverse, so change-of-variables is undefined. */
export class NotInvertibleError extends CapabilityError {}
