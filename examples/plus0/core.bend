import Base

# Two spellings of "add nothing". The line is the same in both, so a mutant
# that names it must say which copy it means -- the table's `nth` field.
def plus0(n: Nat) -> Nat:
  Nat.add(n, 0n)

def plus0_slow(n: Nat) -> Nat:
  Nat.add(n, 0n)

# Adding nothing, twice. Its law cannot be proved alone: the proof rewrites
# with the proof of plus0_same, which lives in that law's own section.
def plus0_twice(n: Nat) -> Nat:
  plus0(plus0(n))
