import Base

# One step, in a file of its own one directory up from the project: a file
# import (`../shared.bend`), not a directory import. A run that mirrors only
# `../<dir>/...` leaves it out of the scratch tree, and the check then reads
# as a counterexample that is false on the core.
def bump(n: Nat) -> Nat:
  Nat.add(n, 1n)
