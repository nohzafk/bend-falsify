import Base
import ./core.bend as C
import ./FACTS.bend as F

# The reference the core is held to: it lives here, not in the core.
def ref(n: Nat) -> Nat:
  Nat.add(n, F.amount())

# Guarantees: plus0 agrees with the reference.
# Why it matters: the reference is what the project means by plus0.
law plus0_is_ref:
  for n: Nat
  {C.plus0(n) == ref(n) : Nat}
