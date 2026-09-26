import Base
import ./core.bend as C

law double_adds:
  for n: Nat
  {C.double(n) == Nat.mul(n, 2n) : Nat}

law keep_same:
  for n: Nat
  {C.keep(n) == n : Nat}

# A step that lives in another file, one directory up.
law shift_same:
  for n: Nat
  {C.shift(n) == Nat.add(n, 1n) : Nat}

# A law with a premise: it covers only the values keep leaves alone.
law keep2_when_keep:
  for n: Nat
  for h: {C.keep(n) == n : Nat}
  {C.keep2(n) == n : Nat}
