import Base
import ./core.bend as C

# Adding nothing is the identity, for every n.
law plus0_same:
  for n: Nat
  {C.plus0(n) == n : Nat}

# The same law for the other spelling of the same step.
law plus0_slow_same:
  for n: Nat
  {C.plus0_slow(n) == n : Nat}

# Adding nothing twice is adding nothing.
law plus0_twice_same:
  for +n: Nat
  {C.plus0_twice(n) == n : Nat}

# A Bool-valued law, to show one in a table: the two spellings of adding
# nothing agree wherever they are applied. Its claim is a `Nat.is_eq(...)`
# equation whose type is `Bool`, not an equation between two `Nat`s.
law plus0_agree:
  for +n: Nat
  {Nat.is_eq(C.plus0(n), C.plus0_slow(n)) == True{} : Bool}
