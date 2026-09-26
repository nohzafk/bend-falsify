import Base
import ./core.bend as C

# The kinds this file's statements are written in. They are defs of this file,
# not of the core, so an instance of a law below is well typed only in a file
# where LAWS.bend's own defs are in scope. This project is what checks that
# rule: `Step()` types a claim, `Ok()` a premise.
def Ok() -> Type: Bool

def Step() -> Type: Nat

law plus0_same:
  for n: Nat
  {C.plus0(n) == n : Step()}

# The same step, under a gate only 0n passes: the law's premise is an equation
# like any other, and its type is a def of this file.
law plus0_under_gate:
  for n: Nat
  for h: {C.gate(n) == True{} : Ok()}
  {C.plus0(n) == n : Nat}
