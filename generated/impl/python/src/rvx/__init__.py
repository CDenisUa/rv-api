"""rvx - reference Python implementation of the RV Exchange Format v1.

Typical use:

    import rvx
    node = rvx.parse_document(json.load(open("x.rv.json")))
    rvx.log_prob(node, 0.0)
    rvx.sample(node, np.random.default_rng(0), 1000)
"""

# Types
from .model import (Capabilities, Joint, Leaf, Mixture, RVNode, Support, Transform)
# Services
from .parse import parse_document, parse_node, to_dict, to_document, validate_semantics
from .operations import capabilities, cdf, log_prob, moments, sample
from .distributions import create as create_distribution, register, registered_names
# Errors
from .errors import (CapabilityError, CapabilityMismatch, MomentsNotAvailable,
                     NotInvertibleError, RVError, ValidationError)

__all__ = [
    "Capabilities", "Joint", "Leaf", "Mixture", "RVNode", "Support", "Transform",
    "parse_document", "parse_node", "to_dict", "to_document", "validate_semantics",
    "capabilities", "cdf", "log_prob", "moments", "sample",
    "create_distribution", "register", "registered_names",
    "RVError", "ValidationError", "CapabilityError", "CapabilityMismatch",
    "MomentsNotAvailable", "NotInvertibleError",
]

__version__ = "1.0.0"
