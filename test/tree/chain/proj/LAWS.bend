import Base
import ./core.bend as C

law step_adds_one:
  for n: Nat
  {C.step(n) == Nat.add(n, 1n) : Nat}
