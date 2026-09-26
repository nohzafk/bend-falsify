import Base
import ./sub/k.bend as K
import ../shared.bend as S

def double(n: Nat) -> Nat:
  Nat.mul(n, K.two())

def keep(n: Nat) -> Nat:
  Nat.add(n, 0n)

def keep2(n: Nat) -> Nat:
  Nat.add(n, 0n)

# The step lives in a file one directory up, imported by name.
def shift(n: Nat) -> Nat:
  S.bump(n)
