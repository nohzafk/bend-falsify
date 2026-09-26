import Base
import ./core.bend as C

law double_adds:
  for n: Nat
  {C.double(n) == Nat.mul(n, 2n) : Nat}

law keep_same:
  for n: Nat
  {C.keep(n) == n : Nat}
