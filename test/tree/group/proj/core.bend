import Base
import ./sub/k.bend as K

def double(n: Nat) -> Nat:
  Nat.mul(n, K.two())

def keep(n: Nat) -> Nat:
  Nat.add(n, 0n)

def keep2(n: Nat) -> Nat:
  Nat.add(n, 0n)
