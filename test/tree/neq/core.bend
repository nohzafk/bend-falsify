import Base

# Adding nothing, the step this project's law is about.
def plus0(n: Nat) -> Nat:
  Nat.add(n, 0n)

# A gate that admits 0n and nothing else. The law below states its claim under
# the gate, so the law's premise is an equation like any other -- and its type
# is a def of LAWS.bend, not a name the core or Base holds.
def gate(n: Nat) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+p:
      False{}
