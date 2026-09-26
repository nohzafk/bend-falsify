import Base

# Adding nothing, the step this project's law is about. The law names the core
# under an alias of its own -- `Core`, not `C` -- so an instance of it has to
# be built in that namespace: this project is what checks the alias rule.
def plus0(n: Nat) -> Nat:
  Nat.add(n, 0n)
