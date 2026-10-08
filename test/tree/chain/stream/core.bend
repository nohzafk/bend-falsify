import Base
import ../keys/core.bend as K

# The second level of an outward chain: this file is imported by the
# project's core, and itself imports a file one directory further out.
def inc(n: Nat) -> Nat:
  Nat.add(n, K.one())
