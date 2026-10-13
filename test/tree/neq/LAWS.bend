import Base
import ./core.bend as C

# The premise is an inequality: the law says nothing at n = 5n.
law plus0_off_five:
  for n: Nat
  for h: {n != 5n : Nat}
  {C.plus0(n) == n : Nat}
